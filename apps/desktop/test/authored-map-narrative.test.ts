/**
 * Authored-narrative half of `loadAuthoredMap` (C1a design "Loader", D7):
 * `.ink` sidecars are resolved BY NAME next to the map
 * (`<map>.<storyId>.ink`), the document's cross-references are validated
 * loudly, and the result carries a `narrative` payload for the per-map
 * bundle.
 *
 * These nine cases port `demo-content.test.ts`'s nine `assembleDemoContent`
 * cases (that file and its `import.meta.glob` source were deleted in task
 * 7.1, so these are now the only home for that coverage). Two
 * mappings are not one-to-one and are recorded rather than faked: "dangling
 * ink storyId" and "missing sidecar" are ONE code path here (story ids are
 * DERIVED from `events` per design D7, so a story with no sidecar IS the
 * dangling reference -- one message names map, event, story and expected
 * path, and two cases assert different halves of it); and "zero or multiple
 * npcs/triggers/events files" has no analogue, there being no glob to be
 * ambiguous about, so the missing-sidecar case replaces it.
 *
 * Every case runs against the committed v4 fixture in `test/authored-narrative/`
 * (task 4.8), so the fixture's `events` are validated by the REAL
 * `parseEventScript` (through `parseMapDocument`) on every run -- spec
 * revision 3 amendment 3. That directory is deliberately NOT named `fixtures`:
 * `.gitignore:35`'s `fixtures/` matches a directory of that name at ANY depth,
 * so a fixture under `test/fixtures/` would be silently untracked (green
 * locally, missing file on a fresh clone).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapDeps } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-narrative');

/**
 * Home-relative path the fixture map is loaded AS. Deliberately the real
 * single-file working-map path (`map-file.ts`'s `MAP_FILE_RELATIVE`), because
 * the sidecar paths under test are derived from it -- copying all three
 * fixture files into `~/.threemaker/maps` is exactly what task 6.9's manual
 * harness does.
 */
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const FIXTURE_MAP_TEXT = fixtureText('current.tmmap.json');

/** The sidecars as the real Tauri fs would see them: keyed by home-relative path, absent = `null`. */
const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.elder.ink': fixtureText('current.elder.ink'),
  '.threemaker/maps/current.guard.ink': fixtureText('current.guard.ink'),
  '.threemaker/maps/current.welcome.ink': fixtureText('current.welcome.ink'),
};

type RawDoc = Record<string, unknown>;

/** Fresh parse of the fixture JSON per call, so a case's `...spread` overrides can never leak into the next case. */
function fixtureDoc(): RawDoc {
  return JSON.parse(FIXTURE_MAP_TEXT) as RawDoc;
}

/** One entry of the fixture's `npcs`/`triggers`, for cases that keep every field but one. */
function fixtureEntry(key: 'npcs' | 'triggers', index: number): RawDoc {
  return (fixtureDoc()[key] as RawDoc[])[index] as RawDoc;
}

function docText(overrides: RawDoc = {}): string {
  return JSON.stringify({ ...fixtureDoc(), ...overrides });
}

function buildDeps(overrides: Partial<AuthoredMapDeps> = {}): AuthoredMapDeps {
  return {
    mapRelativePath: MAP_RELATIVE_PATH,
    readMapDocumentText: vi.fn(async () => docText()),
    readSidecarText: vi.fn(async (path: string) => SIDECARS[path] ?? null),
    // The fixture authors no tileset slot, so a real load resolves no
    // texture at all -- any call here means something ran that should not
    // have (see the ordering case below).
    resolveObjectTexture: vi.fn(async (sha256: string) => {
      throw new Error(`unexpected texture resolution for ${sha256}`);
    }),
    ...overrides,
  };
}

describe('loadAuthoredMap -- authored narrative', () => {
  it('loads the committed v4 fixture: NPCs/triggers floor-resolved, events carried, ink sidecars keyed by story id', async () => {
    const deps = buildDeps();

    const result = await loadAuthoredMap(deps);

    const narrative = result?.narrative;
    expect(narrative?.npcs.map((npc) => [npc.id, npc.floor, npc.onInteract])).toEqual([
      ['elder', 0, 'elder_intro'],
      ['guard', 0, 'guard_check'],
    ]);
    expect(
      narrative?.triggers.map((trigger) => [trigger.id, trigger.floor, trigger.event]),
    ).toEqual([['signpost', 0, 'welcome_sign']]);
    expect(Object.keys(narrative?.events ?? {})).toEqual([
      'elder_intro',
      'guard_check',
      'welcome_sign',
    ]);
    expect(narrative?.worldSeeds).toEqual({ secret_revealed: false });
    // All THREE events use an ink source, so all three sidecars are required:
    // `InkDialogueProvider` is the only provider the desktop constructs, so a
    // `text` source in a shipped fixture would be a dead event.
    expect([...(narrative?.inkSources.keys() ?? [])].sort()).toEqual(['elder', 'guard', 'welcome']);
    expect(narrative?.inkSources.get('elder')).toContain('world_set("secret_revealed", true)');
    expect(deps.readSidecarText).toHaveBeenCalledWith('.threemaker/maps/current.elder.ink');
    expect(deps.readSidecarText).toHaveBeenCalledWith('.threemaker/maps/current.guard.ink');
    expect(deps.readSidecarText).toHaveBeenCalledWith('.threemaker/maps/current.welcome.ink');
  });

  it('fails loudly when an event references a dangling ink storyId, naming the event and the story', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({
          events: {
            elder_intro: [
              {
                type: 'showDialogue',
                source: { kind: 'ink', storyId: 'nonexistent', knot: 'start' },
              },
            ],
            guard_check: [
              { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard', knot: 'start' } },
            ],
            welcome_sign: [{ type: 'showDialogue', source: { kind: 'text', lines: ['sign'] } }],
          },
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/elder_intro.*"nonexistent"/);
  });

  it('resolves a dangling ink storyId nested inside a conditional branch too', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({
          events: {
            elder_intro: [
              {
                type: 'conditional',
                if: { key: 'secret_revealed', op: 'eq', value: true },
                then: [
                  {
                    type: 'showDialogue',
                    source: { kind: 'ink', storyId: 'nested-missing', knot: 'start' },
                  },
                ],
                else: [
                  {
                    type: 'showDialogue',
                    source: { kind: 'ink', storyId: 'elder', knot: 'start' },
                  },
                ],
              },
            ],
            guard_check: [
              { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard', knot: 'start' } },
            ],
            welcome_sign: [{ type: 'showDialogue', source: { kind: 'text', lines: ['sign'] } }],
          },
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/"nested-missing"/);
  });

  it('fails loudly when a referenced .ink sidecar is missing, naming the map, the story and the expected file path', async () => {
    const deps = buildDeps({ readSidecarText: vi.fn(async () => null) });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /current\.tmmap\.json.*"elder".*\.threemaker\/maps\/current\.elder\.ink/,
    );
  });

  it('turns a sidecar READ rejection into the same named narrative failure, never a raw escaping error', async () => {
    const deps = buildDeps({
      readSidecarText: vi.fn(async (path: string) => {
        if (path.endsWith('current.elder.ink')) {
          throw new Error(`forbidden path (tauri fs scope): ${path}`);
        }
        return SIDECARS[path] ?? null;
      }),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /Invalid authored narrative in "\.threemaker\/maps\/current\.tmmap\.json".*"elder".*current\.elder\.ink.*forbidden path \(tauri fs scope\)/,
    );
  });

  it('rejects a path-traversal storyId before any sidecar path is built or read, naming the offending id', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({
          events: {
            elder_intro: [
              {
                type: 'showDialogue',
                source: { kind: 'ink', storyId: '../../../evil', knot: 'start' },
              },
            ],
            guard_check: [
              { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard', knot: 'start' } },
            ],
            welcome_sign: [
              { type: 'showDialogue', source: { kind: 'ink', storyId: 'welcome', knot: 'start' } },
            ],
          },
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/"\.\.\/\.\.\/\.\.\/evil"/);
    expect(deps.readSidecarText).not.toHaveBeenCalled();
  });

  it('rejects a blank/whitespace-only ink sidecar loudly, naming the map, the story and the path', async () => {
    const deps = buildDeps({
      readSidecarText: vi.fn(async (path: string) =>
        path.endsWith('current.guard.ink') ? ' \n\t\n ' : (SIDECARS[path] ?? null),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /current\.tmmap\.json.*"guard".*current\.guard\.ink.*empty/,
    );
  });

  it('fails loudly when an NPC references a dangling onInteract event id, naming both', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({ npcs: [{ ...fixtureEntry('npcs', 0), onInteract: 'missing_event' }] }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/npc "elder".*"missing_event"/);
  });

  it('fails loudly when a trigger references a dangling event id, naming both', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({ triggers: [{ ...fixtureEntry('triggers', 0), event: 'missing_event' }] }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/trigger "signpost".*"missing_event"/);
  });

  it('fails loudly when a sidecar calls world_get but the document declares no world seeds at all', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () => docText({ worldSeeds: {} })),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/world_get/);
  });

  it('fails loudly -- before any texture resolution, so before any dialogue can run -- when the seeds are non-empty but miss a world_get key', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({
          worldSeeds: { unrelated_key: true },
          // A populated slot makes the ordering assertion below real: if
          // validation ran after texture resolution, this WOULD be resolved.
          tileset: { slots: { A1: { object: 'sha-a1' } }, flags: [], semantics: {} },
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /current\.guard\.ink.*world_get\("secret_revealed"\)/,
    );
    expect(deps.resolveObjectTexture).not.toHaveBeenCalled();
  });

  /**
   * C1a follow-up: `key in worldSeeds` is true for Object.prototype names
   * (`toString`, `constructor`, …) even when the document never authored them.
   * Ownership must use Object.hasOwn so a world_get("toString") without a seed
   * still fails the load gate.
   */
  it('fails when world_get asks for a prototype key that is not an own worldSeeds entry', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({
          // Keep real seeds so the fixture's other world_get keys stay valid;
          // only the injected sidecar below exercises the prototype hole.
          worldSeeds: { secret_revealed: false },
        }),
      ),
      readSidecarText: vi.fn(async (path: string) => {
        if (path.endsWith('current.elder.ink')) {
          return '=== start ===\n{world_get("toString")}\n-> DONE\n';
        }
        return SIDECARS[path] ?? null;
      }),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/world_get\("toString"\)/);
  });

  it('fails when an NPC onInteract is a prototype name not authored as an own events key', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({ npcs: [{ ...fixtureEntry('npcs', 0), onInteract: 'toString' }] }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/npc "elder".*"toString"/);
  });

  it('fails when a trigger event is a prototype name not authored as an own events key', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({ triggers: [{ ...fixtureEntry('triggers', 0), event: 'constructor' }] }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/trigger "signpost".*"constructor"/);
  });

  it('leaves narrative undefined and reads no sidecar for an authored map with no narrative content', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        docText({ npcs: [], triggers: [], events: {}, worldSeeds: {} }),
      ),
    });

    const result = await loadAuthoredMap(deps);

    expect(result).not.toBeNull();
    expect(result?.narrative).toBeUndefined();
    expect(deps.readSidecarText).not.toHaveBeenCalled();
  });

  // --- C4: game-defs catalog cross-validation (item/stat ids) ---

  const CATALOG = {
    itemIds: new Set(['potion', 'key']),
    statIds: new Set(['hp', 'mp']),
  };

  /** Minimal narrative map with no NPCs/triggers/ink — only events (text sources). */
  function itemStatDoc(events: RawDoc): string {
    return docText({
      npcs: [],
      triggers: [],
      events,
      worldSeeds: {},
    });
  }

  it('loads giveItem/modifyStat and item/stat conditionals when ids are in the catalog', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          chest: [
            { type: 'giveItem', itemId: 'potion', amount: 1 },
            { type: 'modifyStat', statId: 'hp', delta: 5 },
            {
              type: 'conditional',
              if: { key: 'key', op: 'gt', value: 0, source: 'item' },
              then: [{ type: 'setWorldVar', key: 'opened', value: true }],
              else: [{ type: 'modifyStat', statId: 'mp', delta: -1 }],
            },
            {
              type: 'conditional',
              if: { key: 'hp', op: 'gte', value: 1, source: 'stat' },
              then: [{ type: 'giveItem', itemId: 'key', amount: 1 }],
            },
          ],
        }),
      ),
    });

    const result = await loadAuthoredMap(deps);
    expect(result?.narrative?.events.chest).toHaveLength(4);
  });

  it('loads maps that never use items/stats with an empty catalog (back-compat)', async () => {
    const deps = buildDeps();
    const result = await loadAuthoredMap(deps);
    expect(result?.narrative).toBeDefined();
  });

  it('fails loudly on unknown giveItem itemId, naming map, event, and id', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          chest: [{ type: 'giveItem', itemId: 'ghost_potion', amount: 1 }],
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/giveItem.*unknown item id "ghost_potion"/);
  });

  it('fails loudly on unknown modifyStat statId', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          buff: [{ type: 'modifyStat', statId: 'strength', delta: 1 }],
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/modifyStat.*unknown stat id "strength"/);
  });

  it('fails loudly on unknown conditional source item id', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          check: [
            {
              type: 'conditional',
              if: { key: 'missing_item', op: 'gt', value: 0, source: 'item' },
              then: [{ type: 'setWorldVar', key: 'ok', value: true }],
            },
          ],
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /conditional source "item".*unknown item id "missing_item"/,
    );
  });

  it('fails loudly on unknown conditional source stat id', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          check: [
            {
              type: 'conditional',
              if: { key: 'missing_stat', op: 'gt', value: 0, source: 'stat' },
              then: [{ type: 'setWorldVar', key: 'ok', value: true }],
            },
          ],
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /conditional source "stat".*unknown stat id "missing_stat"/,
    );
  });

  it('walks nested then/else for catalog refs', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          nest: [
            {
              type: 'conditional',
              if: { key: 'opened', op: 'eq', value: false },
              then: [
                {
                  type: 'conditional',
                  if: { key: 'flag', op: 'eq', value: true },
                  then: [{ type: 'giveItem', itemId: 'nested_bad', amount: 1 }],
                },
              ],
              else: [{ type: 'modifyStat', statId: 'also_bad', delta: 1 }],
            },
          ],
        }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/unknown item id "nested_bad"/);
  });

  it('fails loudly when ink item_count names an unknown item id', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          scan: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'itemscan' } }],
        }),
      ),
      readSidecarText: vi.fn(async (path: string) => {
        if (path.endsWith('.itemscan.ink')) {
          return 'EXTERNAL item_count(itemId)\n{item_count("ghost")}\n-> END\n';
        }
        return null;
      }),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/item_count\("ghost"\).*no game-defs item/);
  });

  it('fails loudly when ink stat_get names an unknown stat id', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          scan: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'statscan' } }],
        }),
      ),
      readSidecarText: vi.fn(async (path: string) => {
        if (path.endsWith('.statscan.ink')) {
          return 'EXTERNAL stat_get(statId)\n{stat_get("ghost_stat")}\n-> END\n';
        }
        return null;
      }),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(
      /stat_get\("ghost_stat"\).*no game-defs stat/,
    );
  });

  it('accepts ink item_count/stat_get when ids are in the catalog', async () => {
    const deps = buildDeps({
      gameDefsCatalog: CATALOG,
      readMapDocumentText: vi.fn(async () =>
        itemStatDoc({
          scan: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'okscan' } }],
        }),
      ),
      readSidecarText: vi.fn(async (path: string) => {
        if (path.endsWith('.okscan.ink')) {
          return (
            'EXTERNAL item_count(itemId)\nEXTERNAL stat_get(statId)\n' +
            '{item_count("potion")} {stat_get("hp")}\n-> END\n'
          );
        }
        return null;
      }),
    });

    const result = await loadAuthoredMap(deps);
    expect(result?.narrative?.inkSources.get('okscan')).toContain('item_count("potion")');
  });
});
