/**
 * C8 exit criterion (PLAN_DEV_2 §4): visible rain, with state readable from an
 * Ink conditional, without breaking the HD-2D pipeline.
 *
 * Headless seams only (same pattern as `world-clock-exit-criterion`):
 * `loadAuthoredMap` with injected readers, session `createNarrativeRoot`,
 * `buildMapNarrativeBundle`, pure session-weather helpers, structure-level
 * `createWeatherLayer` + fog uniform round-trip. Live GUI smoke ("visible rain")
 * is the auditor's job.
 *
 * Neighbours:
 * - `session-weather.test.ts` — pure parse / dim / ambient composition (WU-01).
 * - `weather-layer.test.ts` — mesh/count/visibility/uniforms structure (WU-02).
 * - `hd2d-fog-uniforms.test.ts` — fog uniform trio write path (WU-02).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { WorldClock } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField } from '@threemaker/gameplay';
import {
  applyFogUniforms,
  baseSceneLightSetup,
  composeAmbientIntensity,
  createFogUniforms,
  createWeatherLayer,
  DEFAULT_HD2D_KNOBS,
  dayNightAmbientFactor,
  mapHasAuthoredLights,
  parseWeatherMode,
  WEATHER_KEY,
  WEATHER_LOOK_PRESETS,
  type WeatherLayer,
  weatherDimFactor,
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
import { applyGameSaveSessionStores } from '../src/game-save-apply.js';
import { captureGameSaveSnapshot } from '../src/game-save-capture.js';
import type { MapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import type { NarrativeRoot } from '../src/narrative-root.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'weather');
/** Home-relative path the fixture map is loaded as (sidecar derivation base). */
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';
/** Manifest-style mapFile string stored in the save document. */
const MAP_FILE = 'current.tmmap.json';

const TILE_WORLD_SIZE = 1;
const HEIGHT_UNIT = 1;

/** 12:00 day plateau → dayNight ambient factor 1.0. */
const MINUTES_NOON = 720;

/**
 * Fog densify scales used by main.ts weatherVisualHook for mode === 'fog'
 * (not exported; mirrored here so the headless slice pins the same constants).
 */
const FOG_MODE_NEAR_SCALE = 0.35;
const FOG_MODE_FAR_SCALE = 0.45;

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.watcher.ink': fixtureText('current.watcher.ink'),
};

const HOST: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: vi.fn(),
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

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

/**
 * Session root + per-map bundle the way `main.ts` boots an authored map.
 * Clock defaults to noon so ambient composition can pin dayNight × weather.
 */
async function bootSession(): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: NarrativeRoot;
  readonly authored: AuthoredMapResult;
}> {
  const authored = await loadFixtureMap();
  if (!authored) throw new Error('the weather fixture must load');
  const spawn = authored.spawn;
  if (!spawn) throw new Error('the weather fixture must author a spawn');

  const root = createNarrativeRoot({
    createOverlay: () => {
      throw new Error('a headless run must never build the session overlay');
    },
    clock: new WorldClock({ minutesPerRealSecond: 1, startMinutes: MINUTES_NOON }),
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
  });
  if (!bundle) throw new Error('the weather fixture must author narrative');
  return { bundle, root, authored };
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

/** Watcher NPC at (4,4): stand at (4,3) facing down. */
const AT_WATCHER = { x: 4, y: 3, facing: 'down' as const, floor: 0 };
/** Rain lever trigger at (1,1): stand at (2,1) facing left. */
const AT_RAIN_LEVER = { x: 2, y: 1, facing: 'left' as const, floor: 0 };

/** Test surface: createWeatherLayer returns the public API plus inspectable handles. */
type WeatherLayerInspect = WeatherLayer & {
  readonly mesh: THREE.Sprite;
  readonly uniforms: {
    readonly fallSpeed: { value: number };
    readonly driftAmplitude: { value: number };
    readonly scale: { value: THREE.Vector2 };
    readonly tint: { value: THREE.Color };
    readonly opacity: { value: number };
  };
};

describe('exit criterion: weather state drives Ink + visuals (C8)', () => {
  it('Event → state: boots clear (root wins map seed); trigger sets rain and emits', async () => {
    const { root, bundle } = await bootSession();

    // Root seeds weather.current = 'clear' before the map bundle runs.
    // Map worldSeeds also declare the key (load gate) with 'rain', but
    // seedIfAbsent skips the already-present root value.
    expect(root.world.get(WEATHER_KEY)).toBe('clear');
    expect(parseWeatherMode(root.world.get(WEATHER_KEY))).toBe('clear');

    const changed = vi.fn();
    root.world.signals.on('changed', changed);

    pressInteract(bundle, AT_RAIN_LEVER);
    finishDialogue(bundle);

    expect(root.world.get(WEATHER_KEY)).toBe('rain');
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ key: WEATHER_KEY, value: 'rain', previous: 'clear' }),
    );
    expect(bundle.interpreter.state).toBe('idle');
  });

  it('Ink reads weather.current: clear branch before rain event, rain branch after', async () => {
    const { bundle, root } = await bootSession();
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    // 1. Watcher under clear sky.
    expect(root.world.get(WEATHER_KEY)).toBe('clear');
    pressInteract(bundle, AT_WATCHER);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('The sky is clear for now.');
    expect(bundle.interpreter.state).toBe('idle');

    // 2. Pull the rain lever (setWorldVar weather.current = 'rain').
    pressInteract(bundle, AT_RAIN_LEVER);
    finishDialogue(bundle);
    expect(root.world.get(WEATHER_KEY)).toBe('rain');

    // 3. Watcher again — ink re-enters start and reads the live world value.
    pressInteract(bundle, AT_WATCHER);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('The rain soaks the cobblestones.');
    expect(failed).not.toHaveBeenCalled();
    expect(bundle.interpreter.state).toBe('idle');
  });

  it('Visual layer responds: parseWeatherMode → setMode rain shows preset; clear hides', () => {
    const scene = new THREE.Scene();
    const layer = createWeatherLayer({ scene, particleCount: 8 }) as WeatherLayerInspect;

    // Compose through the same parse function main.ts uses on the world signal.
    const rainMode = parseWeatherMode('rain');
    expect(rainMode).toBe('rain');
    layer.setMode(rainMode);
    expect(layer.mesh.visible).toBe(true);
    expect(layer.particlesVisible).toBe(true);
    const rain = WEATHER_LOOK_PRESETS.rain;
    expect(layer.uniforms.fallSpeed.value).toBe(rain.fallSpeed);
    expect(layer.uniforms.driftAmplitude.value).toBe(rain.driftAmplitude);
    expect(layer.uniforms.scale.value.x).toBe(rain.scaleX);
    expect(layer.uniforms.scale.value.y).toBe(rain.scaleY);
    expect(layer.uniforms.opacity.value).toBe(rain.opacity);
    expect(layer.uniforms.tint.value.getHex()).toBe(rain.tint);

    const clearMode = parseWeatherMode('clear');
    layer.setMode(clearMode);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.particlesVisible).toBe(false);

    layer.dispose();
  });

  it('Ambient interplay: rain at noon on a lit map is base × 1.0 × 0.8', async () => {
    const { authored } = await bootSession();
    expect(mapHasAuthoredLights(authored.lights)).toBe(true);

    const litBase = baseSceneLightSetup(true).ambient.intensity;
    expect(litBase).toBe(Math.PI);
    expect(dayNightAmbientFactor(MINUTES_NOON)).toBeCloseTo(1.0);
    expect(weatherDimFactor('rain')).toBe(0.8);

    const composed = composeAmbientIntensity(
      litBase,
      dayNightAmbientFactor(MINUTES_NOON),
      weatherDimFactor('rain'),
    );
    expect(composed).toBeCloseTo(litBase * 1.0 * 0.8);
    expect(composed).toBeCloseTo(Math.PI * 0.8);
  });

  it('Save round-trip: rehydrate rain into a fresh clear root; re-apply restores mode', async () => {
    // Capture with rain active.
    const { root: rainRoot, bundle } = await bootSession();
    pressInteract(bundle, AT_RAIN_LEVER);
    finishDialogue(bundle);
    expect(rainRoot.world.get(WEATHER_KEY)).toBe('rain');

    const snapshot = captureGameSaveSnapshot({
      mapFile: MAP_FILE,
      x: 2,
      y: 2,
      floor: 0,
      facing: 'down',
      world: rainRoot.world.snapshot(),
      inventory: rainRoot.inventory.snapshot(),
      stats: rainRoot.stats.snapshot(),
    });
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error('capture must succeed for rain state');
    expect(snapshot.world[WEATHER_KEY]).toBe('rain');

    const document = gameSaveDocumentFromSnapshot(snapshot);
    const text = serializeGameSaveDocument(document);
    const parsed = parseGameSaveDocument(JSON.parse(text) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.reason}`);
    const restoredSnap = snapshotFromGameSaveDocument(parsed.document);

    // FRESH session defaults to clear (like a new boot before load).
    const freshRoot = createNarrativeRoot({
      createOverlay: () => {
        throw new Error('a headless run must never build the session overlay');
      },
      clock: new WorldClock({ minutesPerRealSecond: 1, startMinutes: MINUTES_NOON }),
    });
    expect(freshRoot.world.get(WEATHER_KEY)).toBe('clear');

    const apply = applyGameSaveSessionStores(restoredSnap, {
      world: freshRoot.world,
      inventory: freshRoot.inventory,
      stats: freshRoot.stats,
    });
    expect(apply).toEqual({ ok: true });
    expect(freshRoot.world.get(WEATHER_KEY)).toBe('rain');

    // replaceAll emits nothing — main.ts explicitly re-applies after world apply.
    // Mirror that re-sync: parseWeatherMode(world.get(WEATHER_KEY)).
    const mode = parseWeatherMode(freshRoot.world.get(WEATHER_KEY));
    expect(mode).toBe('rain');

    // Drive a layer with the restored mode the way applyWeather would.
    const scene = new THREE.Scene();
    const layer = createWeatherLayer({ scene, particleCount: 4 }) as WeatherLayerInspect;
    layer.setMode(mode);
    expect(layer.mesh.visible).toBe(true);
    expect(layer.particlesVisible).toBe(true);
    layer.dispose();
  });

  it('Pipeline unbroken: fog uniforms densify for fog mode and restore defaults', () => {
    // Same constants main.ts weatherVisualHook uses (fog densify / rain-or-clear restore).
    const fog = createFogUniforms(DEFAULT_HD2D_KNOBS.fog);
    expect(fog.color.value.getHex()).toBe(DEFAULT_HD2D_KNOBS.fog.color);
    expect(fog.near.value).toBe(DEFAULT_HD2D_KNOBS.fog.near);
    expect(fog.far.value).toBe(DEFAULT_HD2D_KNOBS.fog.far);

    // mode === 'fog': densified near/far (rain/snow/clear leave defaults).
    applyFogUniforms(
      fog,
      DEFAULT_HD2D_KNOBS.fog.color,
      DEFAULT_HD2D_KNOBS.fog.near * FOG_MODE_NEAR_SCALE,
      DEFAULT_HD2D_KNOBS.fog.far * FOG_MODE_FAR_SCALE,
    );
    expect(fog.color.value.getHex()).toBe(DEFAULT_HD2D_KNOBS.fog.color);
    expect(fog.near.value).toBeCloseTo(DEFAULT_HD2D_KNOBS.fog.near * FOG_MODE_NEAR_SCALE);
    expect(fog.far.value).toBeCloseTo(DEFAULT_HD2D_KNOBS.fog.far * FOG_MODE_FAR_SCALE);

    // mode === 'rain' (or clear/snow): restore knob values exactly.
    applyFogUniforms(
      fog,
      DEFAULT_HD2D_KNOBS.fog.color,
      DEFAULT_HD2D_KNOBS.fog.near,
      DEFAULT_HD2D_KNOBS.fog.far,
    );
    expect(fog.near.value).toBe(DEFAULT_HD2D_KNOBS.fog.near);
    expect(fog.far.value).toBe(DEFAULT_HD2D_KNOBS.fog.far);
    expect(fog.color.value.getHex()).toBe(DEFAULT_HD2D_KNOBS.fog.color);
  });
});
