/**
 * Per-map narrative bundle (C1a design D1, spec R6): the PER-MAP half of the
 * desktop narrative runtime. Everything asserted here is rebuilt on a map swap
 * -- compiled Ink stories, the dialogue provider, the `EventInterpreter`, the
 * floor-scoped `NpcRegistry`/`TriggerIndex` and the NPC sprites. The
 * SESSION-scoped half (`WorldState`, the seed set, the overlay) belongs to
 * `narrative-root.ts` and is pinned by `narrative-root.test.ts`; the one thing
 * asserted about it here is that the bundle uses the root's world rather than
 * constructing its own.
 *
 * Disposal (spec R7) is covered by the last two `describe` blocks: `dispose()`
 * frees exactly what the bundle created, exactly once, and a rebuild after it
 * shares nothing with the disposed bundle except the session root's world.
 *
 * Cases run against the committed v4 fixture in `test/authored-narrative/`
 * (task 4.8) THROUGH the real loader, so the ink sources compiled below are the
 * fixture's real `.ink` files and every cross-reference is really validated.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { ElevationField } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapNarrative } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import type { MapNarrativeBundleDeps } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import type { NarrativeRoot } from '../src/narrative-root.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-narrative');
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';
/** The single sheet object BOTH fixture NPCs reference -- the dedup case's whole point. */
const NPC_SHEET_SHA = '3f1c9a7b5d2e48c06a1b8f4d9e7c2350a6b4d8e1f39c57024b6d8a0e2c4f6183';
/** A SECOND sheet object, so a bundle can own more than one texture (`schema.ts` only requires a non-empty string here). */
const SECOND_SHEET_SHA = 'c48d2f6b17e903a5d8c1b4f70e29a63d5b8c0f24e71a93d6b0c8f5a2e4d719b3';

type RawDoc = Record<string, unknown>;

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.elder.ink': fixtureText('current.elder.ink'),
  '.threemaker/maps/current.guard.ink': fixtureText('current.guard.ink'),
  '.threemaker/maps/current.welcome.ink': fixtureText('current.welcome.ink'),
};

function fixtureDoc(): RawDoc {
  return JSON.parse(fixtureText('current.tmmap.json')) as RawDoc;
}

/** The fixture's narrative as the REAL loader produces it: floors resolved to indices, sidecars read, every reference cross-validated. */
async function fixtureNarrative(overrides: RawDoc = {}): Promise<AuthoredMapNarrative> {
  const result = await loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    readMapDocumentText: async () => JSON.stringify({ ...fixtureDoc(), ...overrides }),
    readSidecarText: async (path) => SIDECARS[path] ?? null,
    resolveObjectTexture: async () => {
      throw new Error('the fixture authors no tileset slot');
    },
  });
  if (!result?.narrative) throw new Error('the fixture must author narrative');
  return result.narrative;
}

/** The fixture's NPCs with the guard moved onto a SECOND sheet object, so the bundle owns two DISTINCT textures. */
function twoSheetNarrative(): Promise<AuthoredMapNarrative> {
  return fixtureNarrative({
    npcs: (fixtureDoc().npcs as RawDoc[]).map((npc, index) =>
      index === 0 ? npc : { ...npc, sprite: { object: SECOND_SHEET_SHA, characterIndex: 0 } },
    ),
  });
}

/** A DIFFERENT authored map over the same fixture events: one NPC and one trigger, both on tiles map A leaves empty. */
function mapBNarrative(): Promise<AuthoredMapNarrative> {
  return fixtureNarrative({
    npcs: [
      {
        id: 'warden',
        x: 5,
        y: 5,
        floor: 'floor-0',
        facing: 'up',
        sprite: { object: SECOND_SHEET_SHA, characterIndex: 2 },
        onInteract: 'guard_check',
      },
    ],
    triggers: [{ id: 'gate', x: 0, y: 5, floor: 'floor-0', on: 'enter', event: 'welcome_sign' }],
  });
}

/** A texture source that spies every texture it hands out, so disposal is counted PER texture instead of merely observed. */
function trackedSheets() {
  const textures: THREE.Texture[] = [];
  const resolveObjectTexture = vi.fn(async () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    vi.spyOn(texture, 'dispose');
    textures.push(texture);
    return { texture };
  });
  return { textures, resolveObjectTexture };
}

/** One floor whose every tile sits at region height `height`, offset by `baseElevation` (`groundYAt`'s two inputs). */
function floorAt(height: number, baseElevation: number) {
  return {
    elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(height))),
    baseElevation,
  };
}

const HOST: EventHost = { moveEntity: vi.fn(), teleport: vi.fn() };

/** A session root whose overlay factory throws, so any case that touches session chrome fails loudly instead of silently passing. */
function createRoot(): NarrativeRoot {
  return createNarrativeRoot({
    createOverlay: () => {
      throw new Error('the bundle must never touch the session overlay');
    },
  });
}

/**
 * The two deps a map SWAP shares across bundles, taken separately from
 * `overrides` so the returned handles are the ones actually used: the session
 * root (spec R6 -- one world for the whole session) and the scene (one map's
 * sprites are added and removed from the same scene as the next map's).
 */
interface SharedSession {
  readonly root?: NarrativeRoot;
  readonly scene?: THREE.Scene;
}

async function build(overrides: Partial<MapNarrativeBundleDeps> = {}, shared: SharedSession = {}) {
  const root = shared.root ?? createRoot();
  const scene = shared.scene ?? new THREE.Scene();
  const resolveObjectTexture = vi.fn(async () => ({
    texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
  }));
  const bundle = await buildMapNarrativeBundle({
    narrative: await fixtureNarrative(),
    root,
    host: HOST,
    scene,
    floors: [floorAt(0, 0)],
    arrival: { x: 2, y: 2, floor: 0 },
    resolveObjectTexture,
    tileWorldSize: 1,
    heightUnit: 1,
    ...overrides,
  });
  return { bundle, root, scene, resolveObjectTexture };
}

describe('buildMapNarrativeBundle', () => {
  // The bundle must NOT construct a `WorldState`, and must seed BEFORE any
  // story is bound: `bindStoryToWorld`'s `world_get` hard-throws on a key the
  // world does not hold (`story-runtime.ts`).
  it("applies the map's worldSeeds to the session root's world", async () => {
    const { root } = await build();

    expect(root.world.get('secret_revealed')).toBe(false);
  });

  it("compiles each referenced ink story and binds it to the ROOT's world", async () => {
    const { bundle, root } = await build();

    bundle.interpreter.run(bundle.events.elder_intro ?? []);
    expect(bundle.interpreter.state).toBe('waiting-for-dialogue');
    bundle.interpreter.advance();
    expect(bundle.interpreter.state).toBe('waiting-for-choice');
    bundle.interpreter.choose(0);

    expect(root.world.get('secret_revealed')).toBe(true);
  });

  // The v4 schema accepts `{kind:'text'}` dialogue sources, so the bundle's
  // provider must execute one instead of aborting the script -- an
  // ink-only provider throws on `open()`, which the interpreter turns into
  // `script:failed` and an error overlay: authored content that can never run.
  it('presents a text dialogue source instead of failing the script', async () => {
    const events = fixtureDoc().events as RawDoc;
    const { bundle } = await build({
      narrative: await fixtureNarrative({
        events: {
          ...events,
          welcome_sign: [
            { type: 'showDialogue', source: { kind: 'text', lines: ['A signpost.'] } },
          ],
        },
      }),
    });
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    bundle.interpreter.run(bundle.events.welcome_sign ?? []);

    expect(failed).not.toHaveBeenCalled();
    expect(lines).toEqual(['A signpost.']);
  });

  it("holds only this map's NPCs, scoped to their own floor", async () => {
    const { bundle } = await build();

    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)?.onInteract).toBe('elder_intro');
    expect(bundle.npcRegistry.findNpcAt(0, 4, 4)?.onInteract).toBe('guard_check');
    expect(bundle.npcRegistry.findNpcAt(1, 1, 1)).toBeUndefined();
    expect(bundle.npcRegistry.occupies(0, 2, 2)).toBe(false);
  });

  // Design D1: `initialTile` = the arrival spawn + the arrival floor, so a
  // trigger the player merely spawns on top of does not fire on arrival.
  it('treats the arrival tile and floor as already entered', async () => {
    const { bundle } = await build({ arrival: { x: 3, y: 2, floor: 0 } });

    expect(bundle.triggerIndex.enter(0, 3, 2)).toEqual([]);
    expect(bundle.triggerIndex.enter(0, 2, 2)).toEqual([]);
    expect(bundle.triggerIndex.enter(0, 3, 2)).toEqual(['welcome_sign']);
  });

  // Both fixture NPCs stand on floor INDEX 0 while the player arrives on floor
  // 1: their sprite Y must come from floor 0's own elevation/baseElevation, not
  // from the floor the player happens to be on.
  it("puts each NPC sprite at its OWN floor's ground, not the arrival floor's", async () => {
    const { bundle } = await build({
      floors: [floorAt(2, 0), floorAt(7, 10)],
      arrival: { x: 2, y: 2, floor: 1 },
    });

    expect(bundle.sprites.map((sprite) => sprite.mesh.position.y)).toEqual([2, 2]);
  });

  it('resolves each distinct sheet object once and reuses it across NPCs', async () => {
    const { bundle, resolveObjectTexture, scene } = await build();

    expect(bundle.sprites).toHaveLength(2);
    expect(scene.children).toHaveLength(2);
    expect(resolveObjectTexture).toHaveBeenCalledTimes(1);
    expect(resolveObjectTexture).toHaveBeenCalledWith(NPC_SHEET_SHA);
  });

  // This is the construction boundary `assertFloorIndex` exists for: a floor id
  // that never got resolved to an index would silently key every lookup to a
  // tile no query can match.
  it('rejects an NPC whose floor is not a runtime floor index', async () => {
    const narrative = await fixtureNarrative();
    const npc = narrative.npcs[0];
    if (!npc) throw new Error('the fixture must author an NPC');

    await expect(
      build({ narrative: { ...narrative, npcs: [{ ...npc, floor: -1 }] } }),
    ).rejects.toThrow(/floor must be a non-negative integer floor index/);
  });

  /**
   * The UPPER floor bound, and the mirror of the `-1` case above: floor index
   * `1` satisfies `assertFloorIndex` (a non-negative integer), so `NpcRegistry`
   * and `TriggerIndex` both accept it and the failure lands in `npcGroundY`
   * instead -- MID sprite loop, i.e. after every sheet texture was resolved and
   * after the first NPC's mesh was already added to the shared scene. Nothing
   * outside the bundle holds a handle to either of those, and the bundle (with
   * its `dispose()`) is never returned, so the build itself must free what it
   * allocated before rethrowing or the whole partial construction leaks.
   */
  it('frees the sprites and sheet textures it allocated when a floor index fails mid-loop', async () => {
    const narrative = await twoSheetNarrative();
    const [first, second] = narrative.npcs;
    if (!first || !second) throw new Error('the fixture must author two NPCs');
    const sheets = trackedSheets();
    const scene = new THREE.Scene();

    await expect(
      build(
        {
          narrative: { ...narrative, npcs: [first, { ...second, floor: 1 }] },
          resolveObjectTexture: sheets.resolveObjectTexture,
        },
        { scene },
      ),
    ).rejects.toThrow(/no floor at index 1 \(have 1 floor\(s\)\)/);

    expect(scene.children).toEqual([]);
    expect(sheets.textures).toHaveLength(2);
    for (const texture of sheets.textures) expect(texture.dispose).toHaveBeenCalledTimes(1);
  });

  // D5 fail-soft, mirroring `authored-map.ts`'s per-slot texture handling: a
  // missing sheet object degrades that NPC to a visible placeholder, loudly.
  it('degrades a missing sheet object to a placeholder and logs it loudly', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { bundle } = await build({
        resolveObjectTexture: vi.fn(async () => {
          throw new Error('object not in the asset store');
        }),
      });

      expect(bundle.sprites).toHaveLength(2);
      expect(logged.mock.calls[0]?.[0]).toContain(NPC_SHEET_SHA);
    } finally {
      logged.mockRestore();
    }
  });
});

/**
 * Spec R5: a map that authors no narrative gets NO interpreter, NO registry and
 * NO sprites, and behaves exactly as it did before this change. The decision
 * lives HERE rather than as an `if` in `main.ts`'s wiring so that it is
 * assertable at all -- `main.ts` has no test harness, so a branch there would
 * leave R5's runtime half unverified (its loader half is pinned by
 * `authored-map-narrative.test.ts`'s "no narrative content" case).
 */
describe('a map that authors no narrative', () => {
  it('builds no bundle', async () => {
    const { bundle } = await build({ narrative: undefined });

    expect(bundle).toBeUndefined();
  });

  it('touches neither the scene, the sheet store nor the session root', async () => {
    const root = createRoot();
    const scene = new THREE.Scene();
    const sheets = trackedSheets();

    await build(
      { narrative: undefined, resolveObjectTexture: sheets.resolveObjectTexture },
      { root, scene },
    );

    expect(scene.children).toEqual([]);
    expect(sheets.resolveObjectTexture).not.toHaveBeenCalled();
    // Not merely "no seeds applied": a content-free map must not even reach
    // `seedIfAbsent`, since its `worldSeeds` do not exist to apply.
    expect(root.world.has('secret_revealed')).toBe(false);
  });
});

// Spec R7. Before this change NPC sprites were added to the scene and never
// disposed -- only hidden -- a GPU leak that per-map rebuild would multiply;
// `main.ts`'s swap sequence now calls `dispose()` instead. Every count below is
// exact on purpose: a texture disposed TWICE is a double free, which "was
// called" would not catch.
describe('MapNarrativeBundle.dispose', () => {
  it('removes every NPC mesh from the scene and disposes each sprite exactly once', async () => {
    const { bundle, scene } = await build();
    const spriteDisposals = bundle.sprites.map((sprite) => vi.spyOn(sprite, 'dispose'));
    expect(scene.children).toHaveLength(2);

    bundle.dispose();

    expect(scene.children).toEqual([]);
    for (const disposal of spriteDisposals) expect(disposal).toHaveBeenCalledTimes(1);
  });

  // Both fixture NPCs share ONE sheet sha, so two sprites hold one texture.
  it('disposes a shared sheet texture exactly once, not once per NPC', async () => {
    const sheets = trackedSheets();
    const { bundle } = await build({ resolveObjectTexture: sheets.resolveObjectTexture });
    expect(bundle.sprites).toHaveLength(2);
    expect(sheets.textures).toHaveLength(1);

    bundle.dispose();

    expect(sheets.textures[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes each distinct sheet texture exactly once', async () => {
    const sheets = trackedSheets();
    const { bundle } = await build({
      narrative: await twoSheetNarrative(),
      resolveObjectTexture: sheets.resolveObjectTexture,
    });
    expect(sheets.textures).toHaveLength(2);

    bundle.dispose();

    for (const texture of sheets.textures) expect(texture.dispose).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on a second call', async () => {
    const sheets = trackedSheets();
    const { bundle, scene } = await build({ resolveObjectTexture: sheets.resolveObjectTexture });
    const removals = vi.spyOn(scene, 'remove');
    const spriteDisposals = bundle.sprites.map((sprite) => vi.spyOn(sprite, 'dispose'));

    bundle.dispose();
    bundle.dispose();

    expect(removals).toHaveBeenCalledTimes(2); // the two sprites, once each
    for (const disposal of spriteDisposals) expect(disposal).toHaveBeenCalledTimes(1);
    expect(sheets.textures[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  // FLOOR textures are disposed by the swap sequence itself (`buildFloorRender`
  // sets `ownsTextures: false`; `main.ts` frees them separately), so a second
  // path over them would double-free. The bundle can only reach the textures it
  // resolved -- pinned with scene content it never added.
  it('never disposes or removes scene content it does not own', async () => {
    const { bundle, scene } = await build();
    const floorTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const floorDisposal = vi.spyOn(floorTexture, 'dispose');
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: floorTexture }),
    );
    scene.add(floorMesh);

    bundle.dispose();

    expect(scene.children).toEqual([floorMesh]);
    expect(floorDisposal).not.toHaveBeenCalled();
  });
});

// Spec R6 + R7: build A -> dispose -> build B over the SAME session root and
// scene, which is what a map swap does.
describe('rebuild after dispose', () => {
  it("leaves only the incoming map's npcs, triggers and sprites live", async () => {
    const root = createRoot();
    const scene = new THREE.Scene();
    const sheetsA = trackedSheets();
    const a = await build({ resolveObjectTexture: sheetsA.resolveObjectTexture }, { root, scene });
    const spriteDisposalsA = a.bundle.sprites.map((sprite) => vi.spyOn(sprite, 'dispose'));

    a.bundle.dispose();
    const b = await build({ narrative: await mapBNarrative() }, { root, scene });

    expect(b.bundle.npcRegistry.findNpcAt(0, 1, 1)).toBeUndefined();
    expect(b.bundle.npcRegistry.findNpcAt(0, 4, 4)).toBeUndefined();
    expect(b.bundle.npcRegistry.findNpcAt(0, 5, 5)?.id).toBe('warden');
    expect(b.bundle.triggerIndex.enter(0, 3, 2)).toEqual([]);
    expect(b.bundle.triggerIndex.enter(0, 0, 5)).toEqual(['welcome_sign']);
    expect(b.bundle.sprites).toHaveLength(1);
    expect(scene.children).toEqual(b.bundle.sprites.map((sprite) => sprite.mesh));
    for (const disposal of spriteDisposalsA) expect(disposal).toHaveBeenCalledTimes(1);
    expect(sheetsA.textures[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  // Seeds are applied once per SESSION, not once per map: B's `seedIfAbsent`
  // must not reset `secret_revealed` to the fixture's `false` seed.
  it('keeps a world value set on map A readable on map B', async () => {
    const root = createRoot();
    const scene = new THREE.Scene();
    const a = await build({}, { root, scene });
    a.bundle.interpreter.run(a.bundle.events.elder_intro ?? []);
    a.bundle.interpreter.advance();
    a.bundle.interpreter.choose(0);
    expect(root.world.get('secret_revealed')).toBe(true);

    a.bundle.dispose();
    await build({ narrative: await mapBNarrative() }, { root, scene });

    expect(root.world.get('secret_revealed')).toBe(true);
  });
});
