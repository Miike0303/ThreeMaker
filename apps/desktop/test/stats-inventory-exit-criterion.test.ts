/**
 * C4 exit criterion (PLAN_DEV_2 §4): chest → inventory → ink condition →
 * stat-driven behavior, plus save v2 round-trip of mid-progress stores.
 *
 * Authored-document path only (same seams as `main.ts`): game-defs catalog,
 * `loadAuthoredMap` deps injection (no real filesystem), session
 * `createNarrativeRoot` with inventory/stats, per-map
 * `buildMapNarrativeBundle`. No GUI.
 *
 * Neighbours:
 * - `authored-narrative-exit-criterion.test.ts` — NPC A→B world flag via ink.
 * - `packages/narrative/test/exit-criterion.test.ts` — bare ink/interpreter.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { WorldClock } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField, Inventory, parseGameDefsJson, StatBlock } from '@threemaker/gameplay';
import {
  gameSaveDocumentFromSnapshot,
  parseGameSaveDocument,
  serializeGameSaveDocument,
  snapshotFromGameSaveDocument,
} from '@threemaker/save';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapResult, GameDefsCatalog } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import { applyGameSaveSessionStores } from '../src/game-save-apply.js';
import { captureGameSaveSnapshot } from '../src/game-save-capture.js';
import type { MapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'stats-inventory');
/** Home-relative path the fixture map is loaded as (sidecar derivation base). */
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';
/** Manifest-style mapFile string stored in the save document. */
const MAP_FILE = 'current.tmmap.json';

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.gatekeeper.ink': fixtureText('current.gatekeeper.ink'),
};

const HOST: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: vi.fn(),
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

const GAME_DEFS = parseGameDefsJson(fixtureText('game-defs.json'));
const GAME_DEFS_CATALOG: GameDefsCatalog = {
  itemIds: new Set(GAME_DEFS.items.map((item) => item.id)),
  statIds: new Set(GAME_DEFS.stats.map((stat) => stat.id)),
};

function loadFixtureMap(): Promise<AuthoredMapResult | null> {
  return loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    gameDefsCatalog: GAME_DEFS_CATALOG,
    readMapDocumentText: async () => fixtureText('current.tmmap.json'),
    readSidecarText: async (path) => SIDECARS[path] ?? null,
    resolveObjectTexture: async () => {
      throw new Error('the fixture authors no tileset slot');
    },
  });
}

/** Session root + per-map bundle the way `main.ts` boots an authored map with game-defs. */
async function bootSession(stores?: {
  readonly inventory?: Inventory;
  readonly stats?: StatBlock;
}): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: ReturnType<typeof createNarrativeRoot>;
}> {
  const authored = await loadFixtureMap();
  if (!authored) throw new Error('the stats-inventory fixture must load');
  const spawn = authored.spawn;
  if (!spawn) throw new Error('the stats-inventory fixture must author a spawn');

  const inventory = stores?.inventory ?? new Inventory();
  const stats = stores?.stats ?? new StatBlock(GAME_DEFS.stats);

  const root = createNarrativeRoot({
    createOverlay: () => {
      throw new Error('a headless run must never build the session overlay');
    },
    inventory,
    stats,
    clock: new WorldClock({ minutesPerRealSecond: 1 }),
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
  if (!bundle) throw new Error('the stats-inventory fixture must author narrative');
  return { bundle, root };
}

/**
 * Interact handler reduced to `main.ts` seams: facing NPC wins, else every
 * interact trigger on the faced tile, both resolved via `bundle.events`.
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

function finishDialogue(bundle: MapNarrativeBundle): void {
  while (bundle.interpreter.state === 'waiting-for-dialogue') bundle.interpreter.advance();
}

/** Chest at (1,1): stand at (2,1) facing left. */
const AT_CHEST = { x: 2, y: 1, facing: 'left' as const, floor: 0 };
/** Gatekeeper NPC at (4,4): stand at (4,3) facing down. */
const AT_GATEKEEPER = { x: 4, y: 3, facing: 'down' as const, floor: 0 };
/** Wound shrine at (3,1): stand at (3,2) facing up. */
const AT_WOUND = { x: 3, y: 2, facing: 'up' as const, floor: 0 };
/** Climb rope vitality check at (5,1): stand at (5,2) facing up. */
const AT_ROPE = { x: 5, y: 2, facing: 'up' as const, floor: 0 };

describe('exit criterion: chest → inventory → ink → stat behavior → save v2', () => {
  it('a chest gives brass_key once; inventory holds it; gatekeeper ink branches on item_count', async () => {
    const { bundle, root } = await bootSession();
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    // 1. Gatekeeper before the chest.
    pressInteract(bundle, AT_GATEKEEPER);
    finishDialogue(bundle);
    const beforeChest = lines.at(-1);
    expect(root.inventory.count('brass_key')).toBe(0);

    // 2. Open the chest (guarded by chest_opened world flag).
    pressInteract(bundle, AT_CHEST);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('You found a brass key.');
    expect(root.inventory.count('brass_key')).toBe(1);
    expect(root.world.get('chest_opened')).toBe(true);

    // 3. Second open is a no-op give (flag-gated).
    pressInteract(bundle, AT_CHEST);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('The chest is empty.');
    expect(root.inventory.count('brass_key')).toBe(1);

    // 4. Gatekeeper after the chest — ink item_count branch.
    pressInteract(bundle, AT_GATEKEEPER);
    finishDialogue(bundle);
    const afterChest = lines.at(-1);

    expect(beforeChest).toBe('Without a key, you shall not pass.');
    expect(afterChest).toBe('You hold the brass key. Pass freely.');
    expect(afterChest).not.toBe(beforeChest);
    expect(failed).not.toHaveBeenCalled();
    expect(bundle.interpreter.state).toBe('idle');
  });

  it('modifyStat changes hp and a source:stat conditional produces a different outcome', async () => {
    const { bundle, root } = await bootSession();
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    // Base hp is 10 (from game-defs). gte 8 → fit branch.
    expect(root.stats.get('hp')).toBe(10);

    pressInteract(bundle, AT_ROPE);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('You feel fit to climb the rope.');
    expect(root.world.get('fit_to_climb')).toBe(true);

    // Wound: hp 10 → 4, below the vitality threshold.
    pressInteract(bundle, AT_WOUND);
    finishDialogue(bundle);
    expect(root.stats.get('hp')).toBe(4);
    expect(lines.at(-1)).toBe('A sharp pain. Your wounds deepen.');

    pressInteract(bundle, AT_ROPE);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('You are too weak to climb the rope.');
    expect(root.world.get('fit_to_climb')).toBe(false);

    expect(failed).not.toHaveBeenCalled();
    expect(bundle.interpreter.state).toBe('idle');
  });

  it('save v2 round-trips inventory, stats, and the ink branch on fresh stores', async () => {
    const { bundle, root } = await bootSession();
    const lines: string[] = [];
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));

    // Mid-progress: key held, chest opened, hp wounded.
    pressInteract(bundle, AT_CHEST);
    finishDialogue(bundle);
    pressInteract(bundle, AT_WOUND);
    finishDialogue(bundle);

    expect(root.inventory.count('brass_key')).toBe(1);
    expect(root.stats.get('hp')).toBe(4);
    expect(root.world.get('chest_opened')).toBe(true);

    pressInteract(bundle, AT_GATEKEEPER);
    finishDialogue(bundle);
    const preSaveInkLine = lines.at(-1);
    expect(preSaveInkLine).toBe('You hold the brass key. Pass freely.');

    const snapshot = captureGameSaveSnapshot({
      mapFile: MAP_FILE,
      x: 2,
      y: 2,
      floor: 0,
      facing: 'down',
      world: root.world.snapshot(),
      inventory: root.inventory.snapshot(),
      stats: root.stats.snapshot(),
    });
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error('capture must succeed for mid-progress state');

    const document = gameSaveDocumentFromSnapshot(snapshot);
    const text = serializeGameSaveDocument(document);
    const parsed = parseGameSaveDocument(JSON.parse(text) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.reason}`);
    expect(parsed.document.version).toBe(2);

    const restoredSnap = snapshotFromGameSaveDocument(parsed.document);

    // FRESH stores from the same defs (empty inventory, base stats) — like a new session.
    const freshInventory = new Inventory();
    const freshStats = new StatBlock(GAME_DEFS.stats);
    const freshRoot = createNarrativeRoot({
      createOverlay: () => {
        throw new Error('a headless run must never build the session overlay');
      },
      inventory: freshInventory,
      stats: freshStats,
      clock: new WorldClock({ minutesPerRealSecond: 1 }),
    });
    expect(freshRoot.inventory.count('brass_key')).toBe(0);
    expect(freshRoot.stats.get('hp')).toBe(10);

    const apply = applyGameSaveSessionStores(restoredSnap, {
      world: freshRoot.world,
      inventory: freshRoot.inventory,
      stats: freshRoot.stats,
    });
    expect(apply).toEqual({ ok: true });
    expect(freshRoot.inventory.count('brass_key')).toBe(1);
    expect(freshRoot.inventory.snapshot()).toEqual({ brass_key: 1 });
    expect(freshRoot.stats.get('hp')).toBe(4);
    expect(freshRoot.world.get('chest_opened')).toBe(true);

    // Fresh map bundle over the same restored inventory/stats instances
    // (what main.ts keeps across a hop/load). Ink and stat conditionals
    // read those stores, not the pre-save world root.
    const restored = await bootSession({
      inventory: freshRoot.inventory,
      stats: freshRoot.stats,
    });
    const restoredLines: string[] = [];
    restored.bundle.interpreter.signals.on('dialogue:line', (event) =>
      restoredLines.push(event.text),
    );

    pressInteract(restored.bundle, AT_GATEKEEPER);
    finishDialogue(restored.bundle);
    expect(restoredLines.at(-1)).toBe(preSaveInkLine);
    expect(restoredLines.at(-1)).toBe('You hold the brass key. Pass freely.');
    expect(restored.root.inventory.count('brass_key')).toBe(1);
    expect(restored.root.stats.get('hp')).toBe(4);

    // Stat-driven branch also matches wounded mid-progress.
    pressInteract(restored.bundle, AT_ROPE);
    finishDialogue(restored.bundle);
    expect(restoredLines.at(-1)).toBe('You are too weak to climb the rope.');
    expect(restored.root.world.get('fit_to_climb')).toBe(false);
  });
});
