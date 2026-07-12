/**
 * `loadAuthoredMap` (loop-crear-jugar design, "Desktop load gating" +
 * "texture resolution"): read -> parse -> translate
 * (`map-document-runtime.ts`) -> per-slot texture resolution, producing full
 * `FloorSource[]` ready for `createMapSession`. Real Tauri fs reads and real
 * texture decode are injected via `AuthoredMapDeps` and mocked here (spec:
 * "Texture resolution's real OS fs is headed-only" -- unit-tested the same
 * way Slice 3's `map-file.test.ts` mocked `@tauri-apps/plugin-fs`).
 */
import type { MapDocument } from '@threemaker/map-format';
import { MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapDeps } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';

const SIZE = 4;

function emptyLayer(): number[] {
  return new Array(SIZE * SIZE).fill(0);
}

function buildFloor(id: string, baseElevation: number) {
  return {
    id,
    baseElevation,
    layers: {
      tiles: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
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

  it('returns null and logs when the file fails to parse/validate', async () => {
    const deps = buildDeps({ readMapDocumentText: vi.fn(async () => 'not valid json') });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await loadAuthoredMap(deps);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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
});
