/**
 * C5 exit criterion (PLAN_DEV_2 §4): a `.glb` authored into a map document
 * loads end-to-end into a runtime scene (instanced, placed, animated), and an
 * HD `tilePixelSize: 96` tileset produces UV ratios that keep the logical grid
 * identical to 48px.
 *
 * Headless seams only (same pattern as `stats-inventory-exit-criterion.test.ts`):
 * `loadAuthoredMap` with injected readers, real `parseGltfBytes` against the
 * committed `cube-spin.glb` fixture, `buildMapProps` into a real `THREE.Scene`.
 * Visual fog/DoF parity is the auditor's live GUI smoke — not claimed here.
 *
 * Neighbours:
 * - `map-props.test.ts` — unit coverage of placement/registry/disposal.
 * - `packages/renderer/test/tile-uv.test.ts` — full HD UV matrix (WU-02).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElevationField } from '@threemaker/gameplay';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  type PropDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import {
  buildChunks,
  buildMapProps,
  computeTileUv,
  parseGltfBytes,
  type SheetPixelSizes,
} from '@threemaker/renderer';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { loadAuthoredMap } from '../src/authored-map.js';
import { tileCenterToWorld } from '../src/character-sprite.js';
import { buildFloorGameplay } from '../src/floor-runtime.js';
import { buildMap, buildTileset } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'props');
const CUBE_SPIN_GLB = readFileSync(join(FIXTURE_DIR, 'cube-spin.glb'));
const CUBE_SPIN_SHA = createHash('sha256').update(CUBE_SPIN_GLB).digest('hex');

const MAP_SIZE = 6;
const TILE_WORLD_SIZE = 1;
const HEIGHT_UNIT = 1;
/** Non-zero floor base so placement samples elevated ground Y (not world Y 0). */
const FLOOR_BASE_ELEVATION = 2;
const PROP_X = 3;
const PROP_Y = 4;
const PROP_ID = 'spinning-cube';
const CLIP_NAME = 'spin';

function emptyLayer(): number[] {
  return new Array(MAP_SIZE * MAP_SIZE).fill(0);
}

function fixtureMapDocument(): MapDocument {
  const prop: PropDocument = {
    id: PROP_ID,
    x: PROP_X,
    y: PROP_Y,
    floor: 'floor-0',
    object: CUBE_SPIN_SHA,
    animation: CLIP_NAME,
  };
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'depth-props-exit',
    name: 'Depth Props Exit Criterion',
    width: MAP_SIZE,
    height: MAP_SIZE,
    tileset: {
      slots: {},
      flags: [],
      semantics: {},
      tilePixelSize: 96,
    },
    floors: [
      {
        id: 'floor-0',
        baseElevation: FLOOR_BASE_ELEVATION,
        layers: {
          tiles: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
          shadows: emptyLayer(),
          regions: emptyLayer(),
        },
      },
    ],
    stairLinks: [],
    rooms: [],
    spawn: { x: 0, y: 0, floor: 'floor-0' },
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [prop],
    lights: [],
  };
}

/** Authored path: injected readers only; no Tauri fs / real texture decode. */
async function loadFixtureAuthoredMap() {
  const doc = fixtureMapDocument();
  return loadAuthoredMap({
    mapRelativePath: '.threemaker/maps/depth-props-exit.tmmap.json',
    readMapDocumentText: async () => serializeMapDocument(doc),
    readSidecarText: async () => null,
    resolveObjectTexture: async () => {
      throw new Error('the exit-criterion fixture authors no tileset slot');
    },
  });
}

function findAnimatedMesh(root: THREE.Object3D): THREE.Object3D {
  let mesh: THREE.Object3D | undefined;
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && mesh === undefined) mesh = obj;
  });
  if (!mesh) throw new Error('cube-spin.glb must yield a mesh');
  return mesh;
}

// 48px reference sheet (16×16 logical tiles) and the 2× HD twin used by WU-02.
const GRID_SHEET_48: SheetPixelSizes = { B: { width: 768, height: 768 } };
const GRID_SHEET_96: SheetPixelSizes = { B: { width: 1536, height: 1536 } };

describe('exit criterion: authored prop → runtime scene + HD tileset UV', () => {
  it('loads a document prop through loadAuthoredMap → buildMapProps into a live scene', async () => {
    const authored = await loadFixtureAuthoredMap();
    if (!authored) throw new Error('the fixture map must load');
    expect(authored.props).toHaveLength(1);
    expect(authored.props[0]?.object).toBe(CUBE_SPIN_SHA);
    expect(authored.props[0]?.animation).toBe(CLIP_NAME);
    expect(authored.floorSources[0]?.tilePixelSize).toBe(96);
    expect(authored.floorSources[0]?.baseElevation).toBe(FLOOR_BASE_ELEVATION);

    const floorSource = authored.floorSources[0];
    if (!floorSource) throw new Error('the fixture must author one floor');
    const floors = [
      buildFloorGameplay(
        floorSource.floorId,
        floorSource.baseElevation,
        floorSource.map,
        floorSource.tileset,
        floorSource.rampCells ?? [],
      ),
    ];

    const scene = new THREE.Scene();
    const resolveObjectBinary = vi.fn(async (sha256: string) => {
      expect(sha256).toBe(CUBE_SPIN_SHA);
      return new Uint8Array(CUBE_SPIN_GLB);
    });

    // Real parseGltfBytes (default) — no stub.
    const bundle = await buildMapProps({
      props: authored.props,
      scene,
      floors,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      resolveObjectBinary,
      parseGltf: parseGltfBytes,
    });
    if (!bundle) throw new Error('expected a props bundle for the authored prop');

    expect(resolveObjectBinary).toHaveBeenCalledTimes(1);
    expect(bundle.count).toBe(1);
    expect(bundle.assetCount).toBe(1);
    expect(scene.children).toHaveLength(1);

    const group = scene.children[0] as THREE.Object3D;
    expect(group.name).toBe('map-props');
    expect(group.children).toHaveLength(1);

    const instance = group.children[0] as THREE.Object3D;
    expect(instance.position.x).toBeCloseTo(tileCenterToWorld(PROP_X, TILE_WORLD_SIZE));
    expect(instance.position.z).toBeCloseTo(tileCenterToWorld(PROP_Y, TILE_WORLD_SIZE));
    // Flat regions + baseElevation 2 → ground Y = 2 * heightUnit.
    expect(instance.position.y).toBeCloseTo(FLOOR_BASE_ELEVATION * HEIGHT_UNIT);

    // Mixer advances: cube-spin.glb's "spin" clip moves Cube.position.y over 1s.
    const mesh = findAnimatedMesh(instance);
    const y0 = mesh.position.y;
    bundle.update(0.25);
    const y1 = mesh.position.y;
    expect(y1).not.toBeCloseTo(y0);
    bundle.update(0.25);
    expect(mesh.position.y).not.toBeCloseTo(y1);

    // Disposal leaves the scene childless and is idempotent.
    bundle.dispose();
    expect(scene.children).toHaveLength(0);
    bundle.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('tilePixelSize 96 keeps UV ratios (logical grid) identical to the 48px reference', () => {
    // Same assertion shape as WU-02's tile-uv HD suite: 2× sheet pixels,
    // same layout → UV-space rects match within floating-point tolerance.
    for (const tileId of [1, 16, 77, 130] as const) {
      const at48 = computeTileUv(tileId, GRID_SHEET_48, 48);
      const at96 = computeTileUv(tileId, GRID_SHEET_96, 96);
      expect(at96?.sheet).toBe(at48?.sheet);
      expect(at96?.quads).toHaveLength(at48?.quads.length ?? 0);
      const q48 = at48?.quads[0];
      const q96 = at96?.quads[0];
      expect(q96?.u0).toBeCloseTo(q48?.u0 ?? NaN);
      expect(q96?.u1).toBeCloseTo(q48?.u1 ?? NaN);
      expect(q96?.v0).toBeCloseTo(q48?.v0 ?? NaN);
      expect(q96?.v1).toBeCloseTo(q48?.v1 ?? NaN);
    }

    // buildChunks threads the same tilePixelSize into computeTileUv; a
    // one-tile map at 96 vs 48 must land on equal UV quads for the painted id.
    const map = buildMap(2, 2);
    map.layers.tileLayers[0] = [1, 0, 0, 0];
    const tileset = buildTileset();
    tileset.sheetNames = { ...tileset.sheetNames, B: 'B' };

    const chunks48 = buildChunks(map, tileset, GRID_SHEET_48, 16, undefined, [], 48);
    const chunks96 = buildChunks(map, tileset, GRID_SHEET_96, 16, undefined, [], 96);
    const tile48 = chunks48[0]?.tiles.find((t) => t.tileX === 0 && t.tileY === 0);
    const tile96 = chunks96[0]?.tiles.find((t) => t.tileX === 0 && t.tileY === 0);
    expect(tile48?.quads).toBeDefined();
    expect(tile96?.quads).toBeDefined();
    expect(tile96?.quads).toHaveLength(tile48?.quads.length ?? 0);
    for (let i = 0; i < (tile48?.quads.length ?? 0); i++) {
      expect(tile96?.quads[i]?.u0).toBeCloseTo(tile48?.quads[i]?.u0 ?? NaN);
      expect(tile96?.quads[i]?.u1).toBeCloseTo(tile48?.quads[i]?.u1 ?? NaN);
      expect(tile96?.quads[i]?.v0).toBeCloseTo(tile48?.quads[i]?.v0 ?? NaN);
      expect(tile96?.quads[i]?.v1).toBeCloseTo(tile48?.quads[i]?.v1 ?? NaN);
    }

    // Sanity: document-level 96 reaches the authored floor source (already
    // asserted in the load path; elevation field remains flat at baseElevation).
    const elevation = new ElevationField(map);
    expect(elevation.surfaceHeightAt(0, 0)).toBe(0);
  });
});
