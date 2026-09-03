/**
 * `loadAuthoredMap` (loop-crear-jugar design, "Desktop load gating" +
 * "texture resolution"): read -> parse -> translate
 * (`map-document-runtime.ts`) -> per-slot texture resolution, producing full
 * `FloorSource[]` ready for `createMapSession`. Real Tauri fs reads and real
 * texture decode are injected via `AuthoredMapDeps` and mocked here (spec:
 * "Texture resolution's real OS fs is headed-only" -- unit-tested the same
 * way Slice 3's `map-file.test.ts` mocked `@tauri-apps/plugin-fs`).
 */
import { CommandRegistry } from '@threemaker/core';
import type { MapDocument } from '@threemaker/map-format';
import { MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { type AudioPlayer, createAudioCommands } from '../src/audio.js';
import {
  type AuthoredMapDeps,
  loadAuthoredMap,
  shouldLoadDevFixture,
} from '../src/authored-map.js';

const SIZE = 4;

function emptyLayer(): number[] {
  return new Array(SIZE * SIZE).fill(0);
}

function buildFloor(id: string, baseElevation: number): MapDocument['floors'][number] {
  const tiles: [number[], number[], number[], number[]] = [
    emptyLayer(),
    emptyLayer(),
    emptyLayer(),
    emptyLayer(),
  ];
  return {
    id,
    baseElevation,
    layers: {
      tiles,
      shadows: emptyLayer(),
      regions: emptyLayer(),
    },
  };
}

function buildDoc(overrides: Partial<MapDocument> = {}): MapDocument {
  return {
    format: MAP_FORMAT_MAGIC,
    version: 3,
    id: 'doc-1',
    name: 'Authored Test Map',
    width: SIZE,
    height: SIZE,
    tileset: {
      slots: { A1: { object: 'sha-good' }, B: { object: 'sha-missing' } },
      flags: [],
      semantics: {},
    },
    floors: [buildFloor('floor-0', 0), buildFloor('floor-1', 3)],
    stairLinks: [
      {
        id: 'link-0-1',
        fromFloor: 'floor-0',
        toFloor: 'floor-1',
        bidirectional: true,
        waypoints: [
          { x: 1, y: 1, floor: 'floor-0' },
          { x: 2, y: 2, floor: 'floor-1' },
        ],
      },
    ],
    rooms: [],
    spawn: { x: 1, y: 1, floor: 'floor-0' },
    ...overrides,
  } as MapDocument;
}

/** A stub "already loaded" texture the mock `resolveObjectTexture` returns for a resolvable object -- deliberately NOT a real `THREE.Texture` instance, so tests can distinguish it from the internal W1 placeholder (which IS a real `THREE.DataTexture`). */
function stubTexture(sha256: string): THREE.Texture {
  return { __stubFor: sha256 } as unknown as THREE.Texture;
}

function buildDeps(overrides: Partial<AuthoredMapDeps> = {}): AuthoredMapDeps {
  return {
    readMapDocumentText: vi.fn(async () => JSON.stringify(buildDoc())),
    resolveObjectTexture: vi.fn(async (sha256: string) => {
      if (sha256 === 'sha-missing') throw new Error('object not found');
      return { texture: stubTexture(sha256), width: 16, height: 16 };
    }),
    ...overrides,
  };
}

describe('loadAuthoredMap', () => {
  it('translates an authored document into floorSources/stairLinks/spawn ready for createMapSession', async () => {
    const deps = buildDeps();

    const result = await loadAuthoredMap(deps);

    expect(result).not.toBeNull();
    expect(result?.floorSources).toHaveLength(2);
    expect(result?.floorSources[0]?.floorId).toBe('floor-0');
    expect(result?.floorSources[1]?.floorId).toBe('floor-1');
    expect(result?.stairLinks).toEqual([
      {
        id: 'link-0-1',
        fromFloor: 0,
        toFloor: 1,
        bidirectional: true,
        waypoints: [
          { x: 1, y: 1, floor: 0 },
          { x: 2, y: 2, floor: 1 },
        ],
      },
    ]);
    expect(result?.spawn).toEqual({ x: 1, y: 1, floorIndex: 0 });
  });

  it('resolves a populated slot to the texture its object resolves to, shared across every floor', async () => {
    const deps = buildDeps();

    const result = await loadAuthoredMap(deps);

    expect(result?.floorSources[0]?.textures.A1).toEqual(stubTexture('sha-good'));
    expect(result?.floorSources[1]?.textures.A1).toEqual(stubTexture('sha-good'));
    expect(result?.floorSources[0]?.sheetPixelSizes.A1).toEqual({ width: 16, height: 16 });
  });

  it('[W1] fails soft on a missing/corrupt asset-store object: logs an error and substitutes a visible placeholder, without aborting the load', async () => {
    const deps = buildDeps();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await loadAuthoredMap(deps);

    expect(result).not.toBeNull();
    // 'B' slot's object ('sha-missing') always rejects in this mock -- must
    // resolve to a REAL THREE.Texture placeholder, not the mocked stub, and
    // must not be undefined/null.
    expect(result?.floorSources[0]?.textures.B).toBeInstanceOf(THREE.Texture);
    expect(result?.floorSources[0]?.textures.B).not.toEqual(stubTexture('sha-missing'));
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('skips an empty tileset slot entirely (no object authored)', async () => {
    const deps = buildDeps();

    const result = await loadAuthoredMap(deps);

    expect(result?.floorSources[0]?.textures.A2).toBeUndefined();
  });

  it('returns null when no authored map file exists yet, without attempting any texture resolution', async () => {
    const deps = buildDeps({ readMapDocumentText: vi.fn(async () => null) });

    const result = await loadAuthoredMap(deps);

    expect(result).toBeNull();
    expect(deps.resolveObjectTexture).not.toHaveBeenCalled();
  });

  it('throws when the file is not valid JSON, so Play cannot treat it as a missing map', async () => {
    const deps = buildDeps({ readMapDocumentText: vi.fn(async () => 'not valid json') });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the map version is newer than this app supports', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        JSON.stringify({ format: MAP_FORMAT_MAGIC, version: 99 }),
      ),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/newer than the current supported version/);
  });

  it('returns null and logs when reading the shared file itself throws', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () => {
        throw new Error('fs unavailable');
      }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await loadAuthoredMap(deps);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('carries validated lights and per-floor lightMap sha + resolved texture (C6)', async () => {
    const lightMapSha = 'ab'.repeat(32);
    const light = {
      id: 'lamp',
      kind: 'point' as const,
      color: '#ffaa00',
      intensity: 1,
      range: 5,
      x: 1,
      y: 1,
      floor: 'floor-0',
    };
    const base = buildDoc({
      version: 6,
      props: [],
      lights: [light],
      floors: [
        {
          ...buildFloor('floor-0', 0),
          lightMap: lightMapSha,
        },
        buildFloor('floor-1', 3),
      ],
      npcs: [],
      triggers: [],
      events: {},
      worldSeeds: {},
    });
    // v6 requires an explicit tileset.tilePixelSize (v3 fixtures omit it).
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        JSON.stringify({
          ...base,
          tileset: { ...base.tileset, tilePixelSize: 48 },
        }),
      ),
      resolveObjectTexture: vi.fn(async (sha256: string) => {
        if (sha256 === 'sha-missing') throw new Error('object not found');
        return { texture: stubTexture(sha256), width: 16, height: 16 };
      }),
    });

    const result = await loadAuthoredMap(deps);

    expect(result?.lights).toEqual([light]);
    expect(result?.floorSources[0]?.lightMap).toBe(lightMapSha);
    expect(result?.floorSources[0]?.lightMapTexture).toEqual(stubTexture(lightMapSha));
    expect(result?.floorSources[1]?.lightMap).toBeUndefined();
    expect(result?.floorSources[1]?.lightMapTexture).toBeUndefined();
    expect(deps.resolveObjectTexture).toHaveBeenCalledWith(lightMapSha);
  });

  it('fails loudly when a floor lightMap object is missing from the store', async () => {
    const lightMapSha = 'cd'.repeat(32);
    const base = buildDoc({
      version: 6,
      props: [],
      lights: [],
      stairLinks: [],
      floors: [
        {
          ...buildFloor('floor-0', 0),
          lightMap: lightMapSha,
        },
      ],
      npcs: [],
      triggers: [],
      events: {},
      worldSeeds: {},
    });
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () =>
        JSON.stringify({
          ...base,
          tileset: { ...base.tileset, tilePixelSize: 48 },
        }),
      ),
      resolveObjectTexture: vi.fn(async (sha256: string) => {
        if (sha256 === lightMapSha) throw new Error('object not found');
        if (sha256 === 'sha-missing') throw new Error('object not found');
        return { texture: stubTexture(sha256), width: 16, height: 16 };
      }),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/lightMap object/);
  });

  /** Minimal v6 document whose events use a plugin-only `playSound` command. */
  function playSoundMapDocText(): string {
    const base = buildDoc({
      version: 6,
      props: [],
      lights: [],
      npcs: [],
      triggers: [],
      // Plugin command — not in the core EventCommand union until registered.
      events: {
        hit: [{ type: 'playSound', path: 'se/hit.ogg' }],
      } as unknown as MapDocument['events'],
      worldSeeds: {},
    });
    return JSON.stringify({
      ...base,
      tileset: { ...base.tileset, tilePixelSize: 48 },
    });
  }

  function fakeAudioPlayer(): AudioPlayer {
    return {
      playSound: vi.fn(),
      playBgm: vi.fn(),
      stopBgm: vi.fn(),
    } as unknown as AudioPlayer;
  }

  it('throws when events use playSound without a plugins CommandRegistry', async () => {
    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () => playSoundMapDocText()),
    });

    await expect(loadAuthoredMap(deps)).rejects.toThrow(/unknown command type "playSound"/);
  });

  it('loads playSound events when the same-style audio CommandRegistry is passed as plugins', async () => {
    const plugins = new CommandRegistry();
    for (const plugin of createAudioCommands(fakeAudioPlayer())) plugins.register(plugin);

    const deps = buildDeps({
      readMapDocumentText: vi.fn(async () => playSoundMapDocText()),
      plugins,
    });

    const result = await loadAuthoredMap(deps);

    expect(result).not.toBeNull();
    expect(result?.narrative?.events.hit).toEqual([{ type: 'playSound', path: 'se/hit.ogg' }]);
  });
});

describe('shouldLoadDevFixture', () => {
  it('loads the DEV demo only when no authored file failed', () => {
    expect(shouldLoadDevFixture(undefined, true)).toBe(true);
    expect(shouldLoadDevFixture('not valid JSON', true)).toBe(false);
    expect(shouldLoadDevFixture(undefined, false)).toBe(false);
    expect(shouldLoadDevFixture('not valid JSON', false)).toBe(false);
  });
});
