/**
 * C7 exit criterion (PLAN_DEV_2 §4): the day-night cycle runs on the world
 * clock, moves C6's lighting, and an NPC is in a different place in the
 * morning than at night.
 *
 * Headless seams only (same pattern as `stats-inventory-exit-criterion` /
 * `npc-routines`): `loadAuthoredMap` with injected readers, session
 * `createNarrativeRoot` + `WorldClock`, `buildMapNarrativeBundle`, pure
 * session-clock + day-night helpers. Live GUI smoke is the auditor's job.
 *
 * Neighbours:
 * - `session-clock.test.ts` — pure tick / resync unit coverage (WU-02).
 * - `npc-routines.test.ts` — routine teleports + dialogue gate (WU-03).
 * - `sheet-tile-lighting.test.ts` — dayNightAmbientFactor curve (WU-02).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { WorldClock } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField } from '@threemaker/gameplay';
import {
  baseSceneLightSetup,
  CLOCK_MINUTES_KEY,
  dayNightAmbientFactor,
  mapHasAuthoredLights,
  resyncClockFromWorldValue,
  tickSessionClock,
} from '@threemaker/renderer';
import {
  gameSaveDocumentFromSnapshot,
  parseGameSaveDocument,
  serializeGameSaveDocument,
  snapshotFromGameSaveDocument,
} from '@threemaker/save';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapResult } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import { tileCenterToWorld } from '../src/character-sprite.js';
import { applyGameSaveSessionStores } from '../src/game-save-apply.js';
import { captureGameSaveSnapshot } from '../src/game-save-capture.js';
import type { MapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import type { NarrativeRoot } from '../src/narrative-root.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'world-clock');
/** Home-relative path the fixture map is loaded as (sidecar derivation base). */
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';
/** Manifest-style mapFile string stored in the save document. */
const MAP_FILE = 'current.tmmap.json';

const TILE_WORLD_SIZE = 1;
const HEIGHT_UNIT = 1;

/** Baker base / pre-dawn rest (tile A) — authored x/y until first routine stop. */
const TILE_A = { x: 1, y: 1 } as const;
/** Bakery (tile B) — 06:00–20:00. */
const TILE_B = { x: 4, y: 2 } as const;
/** Home (tile C) — after 20:00. */
const TILE_C = { x: 5, y: 4 } as const;

/** 08:00 morning build / default session clock. */
const MINUTES_MORNING = 480;
/** 20:30 night — past the home stop at 1200. */
const MINUTES_NIGHT_HOME = 1230;
/** 05:00 pre-dawn — still before bakery open at 360. */
const MINUTES_PREDAWN = 300;
/** 22:30 night ambient plateau. */
const MINUTES_NIGHT_AMBIENT = 1350;

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const HOST: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: vi.fn(),
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

function loadFixtureMap(): Promise<AuthoredMapResult | null> {
  return loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    readMapDocumentText: async () => fixtureText('current.tmmap.json'),
    readSidecarText: async () => null,
    resolveObjectTexture: async () => {
      throw new Error('the fixture authors no tileset slot');
    },
  });
}

/**
 * Session root + per-map bundle the way `main.ts` boots an authored map.
 * Clock defaults to 08:00 (`startMinutes: 480`) unless overridden.
 */
async function bootSession(options?: {
  readonly startMinutes?: number;
  readonly minutesPerRealSecond?: number;
  readonly clock?: WorldClock;
}): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: NarrativeRoot;
  readonly floors: { elevation: ElevationField; baseElevation: number }[];
  readonly authored: AuthoredMapResult;
}> {
  const authored = await loadFixtureMap();
  if (!authored) throw new Error('the world-clock fixture must load');
  const spawn = authored.spawn;
  if (!spawn) throw new Error('the world-clock fixture must author a spawn');

  const startMinutes = options?.startMinutes ?? MINUTES_MORNING;
  const clock =
    options?.clock ??
    new WorldClock({
      minutesPerRealSecond: options?.minutesPerRealSecond ?? 1,
      startMinutes,
    });

  const root = createNarrativeRoot({
    createOverlay: () => {
      throw new Error('a headless run must never build the session overlay');
    },
    clock,
  });

  const floors = [
    {
      elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))),
      baseElevation: 0,
    },
  ];

  const bundle = await buildMapNarrativeBundle({
    narrative: authored.narrative,
    root,
    host: HOST,
    scene: new THREE.Scene(),
    floors,
    arrival: { x: spawn.x, y: spawn.y, floor: spawn.floorIndex },
    resolveObjectTexture: async () => ({
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    }),
    tileWorldSize: TILE_WORLD_SIZE,
    heightUnit: HEIGHT_UNIT,
    // Evening/night boot places routines at the session clock minute.
    minutes: clock.minutes,
  });
  if (!bundle) throw new Error('the world-clock fixture must author narrative');
  return { bundle, root, floors, authored };
}

function bakerSprite(bundle: MapNarrativeBundle) {
  const sprite = bundle.sprites[0];
  if (!sprite) throw new Error('expected baker sprite');
  return sprite;
}

function expectBakerAt(
  bundle: MapNarrativeBundle,
  tile: { readonly x: number; readonly y: number },
  groundY: number,
): void {
  expect(bundle.npcRegistry.findNpcAt(0, tile.x, tile.y)?.id).toBe('baker');
  const sprite = bakerSprite(bundle);
  expect(sprite.mesh.position.x).toBeCloseTo(tileCenterToWorld(tile.x, TILE_WORLD_SIZE));
  expect(sprite.mesh.position.z).toBeCloseTo(tileCenterToWorld(tile.y, TILE_WORLD_SIZE));
  expect(sprite.mesh.position.y).toBeCloseTo(groundY);
}

/** Interact handler reduced to `main.ts` seams (facing NPC else faced-tile triggers). */
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

/** Stand south of the time_sign at (3,3), face up. */
const AT_TIME_SIGN = { x: 3, y: 4, facing: 'up' as const, floor: 0 };

/**
 * Pure composition of `applyDayNightAmbient`'s core: base setup intensity ×
 * day/night factor. main.ts is not headless; this is the exported pure seam.
 */
function effectiveAmbientIntensity(hasLights: boolean, minutes: number): number {
  return baseSceneLightSetup(hasLights).ambient.intensity * dayNightAmbientFactor(minutes);
}

describe('exit criterion: clock → lighting + NPC morning vs night (C7)', () => {
  it('Clock → world: session seeds clock.minutes; tick crosses to 08:02 once with final value', async () => {
    const { root } = await bootSession({ startMinutes: MINUTES_MORNING, minutesPerRealSecond: 1 });

    expect(root.clock.minutes).toBe(MINUTES_MORNING);
    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(480);

    const setSpy = vi.spyOn(root.world, 'set');

    // Sub-minute: no write.
    expect(tickSessionClock(root.clock, root.world, 0.4)).toBe(0);
    expect(setSpy).not.toHaveBeenCalled();
    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(480);

    // 2.0 real seconds at 1 sim-min/s from 08:00 → 08:02; one write of the final minute.
    expect(tickSessionClock(root.clock, root.world, 2.0)).toBe(2);
    expect(root.clock.minutes).toBe(482);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(CLOCK_MINUTES_KEY, 482);
    expect(root.world.get(CLOCK_MINUTES_KEY)).toBe(482);
  });

  it('Cycle moves lighting: morning factor 1.0, night 0.35; lit ambient is base × factor', async () => {
    const { authored } = await bootSession();
    expect(mapHasAuthoredLights(authored.lights)).toBe(true);

    const litBase = baseSceneLightSetup(true);
    expect(litBase.ambient.intensity).toBe(Math.PI);
    expect(litBase.directional).toBeNull();

    // 08:00 full day; 22:30 night plateau.
    expect(dayNightAmbientFactor(MINUTES_MORNING)).toBeCloseTo(1.0);
    expect(dayNightAmbientFactor(MINUTES_NIGHT_AMBIENT)).toBeCloseTo(0.35);

    expect(effectiveAmbientIntensity(true, MINUTES_MORNING)).toBeCloseTo(Math.PI * 1.0);
    expect(effectiveAmbientIntensity(true, MINUTES_NIGHT_AMBIENT)).toBeCloseTo(Math.PI * 0.35);
  });

  it('NPC morning vs night: baker at bakery (B) at 08:00, home (C) at 20:30, base (A) at 05:00', async () => {
    const groundY = 0;
    const { bundle } = await bootSession({ startMinutes: MINUTES_MORNING });

    // Post-build at 08:00: bakery open (stop at 360).
    expect(bundle.npcRegistry.findNpcAt(0, TILE_A.x, TILE_A.y)).toBeUndefined();
    expectBakerAt(bundle, TILE_B, groundY);
    expect(bundle.npcRegistry.findNpcAt(0, TILE_C.x, TILE_C.y)).toBeUndefined();

    // 20:30 → home; old bakery tile free.
    const toHome = bundle.applyRoutines(MINUTES_NIGHT_HOME);
    expect(toHome).toHaveLength(1);
    expect(toHome[0]?.npcId).toBe('baker');
    expect(toHome[0]?.position).toEqual({ x: TILE_C.x, y: TILE_C.y, groundY });
    expect(bundle.npcRegistry.findNpcAt(0, TILE_B.x, TILE_B.y)).toBeUndefined();
    expectBakerAt(bundle, TILE_C, groundY);

    // 05:00 → base (pre-dawn rest); home free.
    const toBase = bundle.applyRoutines(MINUTES_PREDAWN);
    expect(toBase).toHaveLength(1);
    expect(toBase[0]?.npcId).toBe('baker');
    expect(toBase[0]?.position).toEqual({ x: TILE_A.x, y: TILE_A.y, groundY });
    expect(bundle.npcRegistry.findNpcAt(0, TILE_C.x, TILE_C.y)).toBeUndefined();
    expectBakerAt(bundle, TILE_A, groundY);
  });

  it('Scripts read time: clock.minutes gte 1200 takes then at night and else at morning', async () => {
    const night = await bootSession({ startMinutes: MINUTES_NIGHT_HOME });
    // Build seeds world from clock; keep world in lockstep with the night minute.
    expect(night.root.world.get(CLOCK_MINUTES_KEY)).toBe(MINUTES_NIGHT_HOME);

    const nightLines: string[] = [];
    night.bundle.interpreter.signals.on('dialogue:line', (event) => nightLines.push(event.text));
    pressInteract(night.bundle, AT_TIME_SIGN);
    finishDialogue(night.bundle);
    expect(nightLines.at(-1)).toBe('It is late. The streets are dark.');
    expect(night.root.world.get('time_branch')).toBe('night');
    expect(night.bundle.interpreter.state).toBe('idle');

    const morning = await bootSession({ startMinutes: MINUTES_MORNING });
    expect(morning.root.world.get(CLOCK_MINUTES_KEY)).toBe(MINUTES_MORNING);

    const morningLines: string[] = [];
    morning.bundle.interpreter.signals.on('dialogue:line', (event) =>
      morningLines.push(event.text),
    );
    pressInteract(morning.bundle, AT_TIME_SIGN);
    finishDialogue(morning.bundle);
    expect(morningLines.at(-1)).toBe('Daylight still holds.');
    expect(morning.root.world.get('time_branch')).toBe('day');
    expect(morning.bundle.interpreter.state).toBe('idle');
  });

  it('Save round-trip: rehydrate clock.minutes into a fresh 08:00 session, restore night pose + ambient', async () => {
    // Capture mid-night progress (22:30) — world carries clock.minutes.
    const { root: nightRoot } = await bootSession({ startMinutes: MINUTES_NIGHT_AMBIENT });
    expect(nightRoot.world.get(CLOCK_MINUTES_KEY)).toBe(MINUTES_NIGHT_AMBIENT);
    expect(nightRoot.clock.minutes).toBe(MINUTES_NIGHT_AMBIENT);

    const snapshot = captureGameSaveSnapshot({
      mapFile: MAP_FILE,
      x: 2,
      y: 2,
      floor: 0,
      facing: 'down',
      world: nightRoot.world.snapshot(),
      inventory: nightRoot.inventory.snapshot(),
      stats: nightRoot.stats.snapshot(),
      stories: new Map(),
    });
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error('capture must succeed for night state');
    expect(snapshot.world[CLOCK_MINUTES_KEY]).toBe(MINUTES_NIGHT_AMBIENT);

    const document = gameSaveDocumentFromSnapshot(snapshot);
    const text = serializeGameSaveDocument(document);
    const parsed = parseGameSaveDocument(JSON.parse(text) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.reason}`);
    const restoredSnap = snapshotFromGameSaveDocument(parsed.document);

    // FRESH session defaults to 08:00 (like a new boot before load).
    const freshClock = new WorldClock({ minutesPerRealSecond: 1, startMinutes: MINUTES_MORNING });
    const freshRoot = createNarrativeRoot({
      createOverlay: () => {
        throw new Error('a headless run must never build the session overlay');
      },
      clock: freshClock,
    });
    expect(freshRoot.clock.minutes).toBe(MINUTES_MORNING);
    expect(freshRoot.world.get(CLOCK_MINUTES_KEY)).toBe(MINUTES_MORNING);

    const apply = applyGameSaveSessionStores(restoredSnap, {
      world: freshRoot.world,
      inventory: freshRoot.inventory,
      stats: freshRoot.stats,
    });
    expect(apply).toEqual({ ok: true });
    expect(freshRoot.world.get(CLOCK_MINUTES_KEY)).toBe(MINUTES_NIGHT_AMBIENT);
    // Clock object still at default until resync (main.ts order after world apply).
    expect(freshRoot.clock.minutes).toBe(MINUTES_MORNING);

    expect(resyncClockFromWorldValue(freshRoot.clock, freshRoot.world.get(CLOCK_MINUTES_KEY))).toBe(
      true,
    );
    expect(freshRoot.clock.minutes).toBe(MINUTES_NIGHT_AMBIENT);

    // Fresh map bundle built at the restored minute — baker at home; ambient night.
    const restored = await bootSession({ clock: freshRoot.clock });
    // World on the fresh root was already replaced; re-seed only if absent is a no-op for clock.
    // Bundle uses the shared clock instance at 22:30.
    expect(restored.root.clock.minutes).toBe(MINUTES_NIGHT_AMBIENT);
    expectBakerAt(restored.bundle, TILE_C, 0);

    // Explicit re-apply mirrors main.ts save-load: applyRoutines(clock.minutes).
    expect(restored.bundle.applyRoutines(restored.root.clock.minutes)).toHaveLength(0);
    expectBakerAt(restored.bundle, TILE_C, 0);

    expect(dayNightAmbientFactor(restored.root.clock.minutes)).toBeCloseTo(0.35);
    expect(effectiveAmbientIntensity(true, restored.root.clock.minutes)).toBeCloseTo(
      Math.PI * 0.35,
    );
  });
});
