/**
 * Spec R8's exit criterion on the AUTHORED DOCUMENT path (task 6.1). Deliberately
 * NOT the DEV fixture glob -- that path is deleted by this change, and R8 says
 * this requirement "MUST NOT be satisfied by the DEV fixture glob path".
 *
 * How this differs from the two neighbouring files, both of which are needed:
 * - `packages/narrative/test/exit-criterion.test.ts` proves the ink/interpreter
 *   mechanics on its own `.ink` fixtures, with hand-written scripts and its own
 *   `WorldState`/provider (spec R9 requires it to keep passing UNMODIFIED).
 * - `authored-narrative-ink.test.ts` compiles the committed fixture's real
 *   sidecars, but still hand-writes the scripts and owns its own world.
 * - THIS file starts from the committed `.tmmap` v4 DOCUMENT and reaches the
 *   dialogue through the same three lookups `main.ts` performs: the loader's
 *   cross-validated narrative, the per-map bundle over a session-scoped root,
 *   and `npcRegistry`/`triggerIndex` + `bundle.events[...]` keyed by nothing but
 *   document data. Every script, story id, seed and tile below comes from the
 *   document; no engine-side wiring names any of them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapResult } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import type { MapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-narrative');
/** Where a dev copies the fixture for task 6.9's manual harness; the sidecar paths below are the ones the loader derives from it. */
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.elder.ink': fixtureText('current.elder.ink'),
  '.threemaker/maps/current.guard.ink': fixtureText('current.guard.ink'),
  '.threemaker/maps/current.welcome.ink': fixtureText('current.welcome.ink'),
};

const HOST: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: vi.fn(),
};

/** The committed v4 document + its sidecars, through the REAL loader (only fs is faked, as in every other desktop test). */
function loadFixtureMap(): Promise<AuthoredMapResult | null> {
  return loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    readMapDocumentText: async () => fixtureText('current.tmmap.json'),
    readSidecarText: async (path) => SIDECARS[path] ?? null,
    resolveObjectTexture: async () => {
      throw new Error('the fixture authors no tileset slot');
    },
  });
}

/** Loader -> session root -> per-map bundle, the way `main.ts` wires a booted authored map. */
async function bootAuthoredMap(): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: ReturnType<typeof createNarrativeRoot>;
  readonly spawn: { readonly x: number; readonly y: number };
}> {
  const authored = await loadFixtureMap();
  if (!authored) throw new Error('the committed fixture must load');
  const spawn = authored.spawn;
  if (!spawn) throw new Error('the committed fixture must author a spawn');

  const root = createNarrativeRoot({
    createOverlay: () => {
      throw new Error('a headless run must never build the session overlay');
    },
  });
  const bundle = await buildMapNarrativeBundle({
    narrative: authored.narrative,
    root,
    host: HOST,
    scene: new THREE.Scene(),
    floors: [
      { elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))), baseElevation: 0 },
    ],
    arrival: { x: spawn.x, y: spawn.y, floor: spawn.floorIndex },
    resolveObjectTexture: async () => ({
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    }),
    tileWorldSize: 1,
    heightUnit: 1,
  });
  if (!bundle) throw new Error('the committed fixture must author narrative');
  return { bundle, root, spawn };
}

/**
 * The `E` keypress, reduced to exactly what `main.ts`'s interact handler does:
 * an adjacent facing NPC's `onInteract` wins, otherwise every `interact` trigger
 * on the faced tile runs. Both event keys are resolved through
 * `bundle.events` -- document data, not a test-side script literal.
 */
function pressInteract(
  bundle: MapNarrativeBundle,
  at: {
    readonly x: number;
    readonly y: number;
    readonly facing: Direction;
    readonly floor: number;
  },
): void {
  const npc = bundle.npcRegistry.npcAdjacentFacing(at.floor, at.x, at.y, at.facing);
  if (npc) {
    bundle.interpreter.run(bundle.events[npc.onInteract] ?? []);
    return;
  }
  for (const eventId of bundle.triggerIndex.interact(at.floor, at.x, at.y, at.facing)) {
    bundle.interpreter.run(bundle.events[eventId] ?? []);
  }
}

/** Runs the current dialogue to its end, so the interpreter is idle again before the next interaction. */
function finishDialogue(bundle: MapNarrativeBundle): void {
  while (bundle.interpreter.state === 'waiting-for-dialogue') bundle.interpreter.advance();
}

describe('exit criterion: two authored NPCs on one .tmmap share world state', () => {
  it("a choice in the elder's story changes the guard's dialogue", async () => {
    const { bundle, root } = await bootAuthoredMap();
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    // 1. The guard, before the elder's choice. Player at (4,3) facing down; the
    //    guard is authored on (4,4).
    pressInteract(bundle, { x: 4, y: 3, facing: 'down', floor: 0 });
    finishDialogue(bundle);
    const beforeChoice = lines.at(-1);

    // 2. The elder, taking the world-altering choice. Player at (2,1) facing
    //    left; the elder is authored on (1,1).
    pressInteract(bundle, { x: 2, y: 1, facing: 'left', floor: 0 });
    expect(bundle.interpreter.state).toBe('waiting-for-dialogue');
    bundle.interpreter.advance();
    expect(bundle.interpreter.state).toBe('waiting-for-choice');
    bundle.interpreter.choose(0);
    finishDialogue(bundle);

    // The value landed on the SESSION root's world, not on a world the bundle
    // made for itself -- that is what makes it survive the next map swap.
    expect(root.world.get('secret_revealed')).toBe(true);

    // 3. The guard again.
    pressInteract(bundle, { x: 4, y: 3, facing: 'down', floor: 0 });
    finishDialogue(bundle);
    const afterChoice = lines.at(-1);

    expect(beforeChoice).toBe('Halt! State your business.');
    expect(afterChoice).toBe('Ah, so the elder told you about the passage. Move along.');
    expect(failed).not.toHaveBeenCalled();
    expect(bundle.interpreter.state).toBe('idle');
  });

  // Spec R5's third scenario, on the same document: the authored `enter` trigger
  // fires once per arrival, and its event resolves through the same
  // `bundle.events` lookup an NPC's does.
  it("an authored enter trigger runs its event once per arrival on the player's floor", async () => {
    const { bundle, spawn } = await bootAuthoredMap();
    const lines: string[] = [];
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));

    // The spawn tile itself is "already entered" (design D1's `initialTile`).
    expect(bundle.triggerIndex.enter(0, spawn.x, spawn.y)).toEqual([]);

    for (const eventId of bundle.triggerIndex.enter(0, 3, 2)) {
      bundle.interpreter.run(bundle.events[eventId] ?? []);
    }
    finishDialogue(bundle);

    expect(lines).toEqual(['A weathered signpost. Welcome to the village.']);
    // Standing still re-reports the same tile; a second run would double-fire.
    expect(bundle.triggerIndex.enter(0, 3, 2)).toEqual([]);
    // A different floor's same tile is a different key entirely.
    expect(bundle.triggerIndex.enter(1, 3, 2)).toEqual([]);
  });
});
