/**
 * C6 exit criterion (PLAN_DEV_2 §4): three demonstrable light modes in one
 * authored map document — baked lightmap, dynamic placed scene light, and a
 * player-attached torch — load end-to-end with each mode verifiably active.
 *
 * Headless seams only (same pattern as `depth-props-exit-criterion.test.ts`):
 * `loadAuthoredMap` with injected readers/texture resolver, `buildMapLights`,
 * pure lit-mode helpers, and renderer `createSheetMaterials` / `buildChunkGroup`.
 * FPS budget and visual fog/light parity are the auditor's live GUI smoke —
 * the frameTimeMs getter exists for that path; this file does not fake FPS.
 *
 * main.ts wiring (StreamingTilemapScene bag + shared ambient swap) is not
 * reachable headless; Mode 1 / lit interplay assert at authored-map
 * carry-through + `buildSheetLightingOptions` / `createSheetMaterials` /
 * chunk-merge seams instead.
 *
 * Neighbours:
 * - `map-lights.test.ts` — unit coverage of budget/placement/attach.
 * - `sheet-tile-lighting.test.ts` — pure lit helpers (WU-04).
 * - `packages/renderer/test/sheet-materials.test.ts` — lightMap channel 1.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_MAP_FORMAT_VERSION,
  type LightDocument,
  MAP_FORMAT_MAGIC,
  type MapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import {
  assertLightBudget,
  baseSceneLightSetup,
  buildChunkGroup,
  buildChunks,
  buildMapLights,
  buildSheetLightingOptions,
  createSheetMaterials,
  mapHasAuthoredLights,
  type SheetPixelSizes,
} from '@threemaker/renderer';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { loadAuthoredMap } from '../src/authored-map.js';
import { tileCenterToWorld } from '../src/character-sprite.js';
import { buildFloorGameplay } from '../src/floor-runtime.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'lighting');
const LIGHTMAP_PNG = readFileSync(join(FIXTURE_DIR, 'floor-lightmap.png'));
const LIGHTMAP_SHA = createHash('sha256').update(LIGHTMAP_PNG).digest('hex');

const MAP_SIZE = 6;
const TILE_WORLD_SIZE = 1;
const HEIGHT_UNIT = 1;
const FLOOR_BASE_ELEVATION = 1;

/** Placed point light — known tile / height / color / range for Mode 2. */
const PLACED_LAMP: LightDocument = {
  id: 'ceiling-lamp',
  kind: 'point',
  color: '#ffaa00',
  intensity: 1.5,
  range: 8,
  x: 2,
  y: 3,
  floor: 'floor-0',
  height: 2,
};

/** Player-attached torch — Mode 3. */
const PLAYER_TORCH: LightDocument = {
  id: 'player-torch',
  kind: 'point',
  color: '#ff8800',
  intensity: 1,
  range: 5,
  attach: 'player',
};

const SHEET_48: SheetPixelSizes = { B: { width: 768, height: 768 } };

function emptyLayer(): number[] {
  return new Array(MAP_SIZE * MAP_SIZE).fill(0);
}

/** A couple of painted B-sheet tiles so chunk meshes exist for lit merge. */
function paintedTilesLayer(): number[] {
  const layer = emptyLayer();
  layer[0] = 1; // tile (0,0)
  layer[MAP_SIZE + 1] = 1; // tile (1,1)
  return layer;
}

function fixtureMapDocument(
  lights: readonly LightDocument[] = [PLACED_LAMP, PLAYER_TORCH],
): MapDocument {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'lighting-exit',
    name: 'Lighting Exit Criterion',
    width: MAP_SIZE,
    height: MAP_SIZE,
    tileset: {
      slots: {},
      flags: [],
      semantics: {},
      tilePixelSize: 48,
    },
    floors: [
      {
        id: 'floor-0',
        baseElevation: FLOOR_BASE_ELEVATION,
        layers: {
          tiles: [paintedTilesLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
          shadows: emptyLayer(),
          regions: emptyLayer(),
        },
        lightMap: LIGHTMAP_SHA,
      },
    ],
    stairLinks: [],
    rooms: [],
    spawn: { x: 0, y: 0, floor: 'floor-0' },
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [],
    lights: [...lights],
  };
}

/** Authored path: injected readers only; no Tauri fs / real texture decode. */
async function loadFixtureAuthoredMap() {
  const doc = fixtureMapDocument();
  const resolveObjectTexture = vi.fn(async (sha256: string) => {
    expect(sha256).toBe(LIGHTMAP_SHA);
    // Stub texture stand-in; real PNG bytes are hashed for the document ref only.
    return { texture: new THREE.Texture(), width: 8, height: 8 };
  });
  const authored = await loadAuthoredMap({
    mapRelativePath: '.threemaker/maps/lighting-exit.tmmap.json',
    readMapDocumentText: async () => serializeMapDocument(doc),
    readSidecarText: async () => null,
    resolveObjectTexture,
  });
  return { authored, resolveObjectTexture, doc };
}

function firstMapLight(scene: THREE.Scene, predicate?: (l: THREE.Light) => boolean): THREE.Light {
  const group = scene.children.find((c) => c.name === 'map-lights');
  if (!group) throw new Error('expected map-lights group');
  const lights = group.children.filter((c) => (c as THREE.Light).isLight) as THREE.Light[];
  const light = predicate ? lights.find(predicate) : lights[0];
  if (!light) throw new Error('expected a light in the group');
  return light;
}

describe('exit criterion: three light modes in one authored scene (C6)', () => {
  it('Mode 1 (baked): loadAuthoredMap resolves lightMap sha; materials get channel-1 lightMap', async () => {
    const { authored, resolveObjectTexture } = await loadFixtureAuthoredMap();
    if (!authored) throw new Error('the fixture map must load');

    expect(authored.floorSources).toHaveLength(1);
    const floor = authored.floorSources[0];
    if (!floor) throw new Error('expected one floor source');

    // Document ref + injected object resolution (sha computed from committed PNG).
    expect(LIGHTMAP_SHA).toHaveLength(64);
    expect(floor.lightMap).toBe(LIGHTMAP_SHA);
    expect(floor.lightMapTexture).toBeInstanceOf(THREE.Texture);
    expect(resolveObjectTexture).toHaveBeenCalledWith(LIGHTMAP_SHA);

    // Desktop pure seam into StreamingTilemapScene options (main.ts not headless).
    const lighting = buildSheetLightingOptions(
      mapHasAuthoredLights(authored.lights),
      floor.lightMapTexture,
    );
    expect(lighting).toEqual({ lit: true, lightMap: floor.lightMapTexture });

    // createSheetMaterials-level proof: lightMap bound, UV channel 1 (uv1).
    const materials = createSheetMaterials({ B: new THREE.Texture() }, {}, lighting);
    const material = materials.B as THREE.MeshLambertMaterial;
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.lightMap).toBe(floor.lightMapTexture);
    expect(material.lightMapIntensity).toBe(1);
    expect(floor.lightMapTexture?.channel).toBe(1);
  });

  it('Mode 2 (dynamic placed): buildMapLights yields the lamp at expected world pose/color/range', async () => {
    const { authored } = await loadFixtureAuthoredMap();
    if (!authored) throw new Error('the fixture map must load');
    const floorSource = authored.floorSources[0];
    if (!floorSource) throw new Error('expected one floor source');

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
    const bundle = buildMapLights({
      lights: authored.lights,
      scene,
      floors,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      npcPositions: new Map(),
    });
    if (!bundle) throw new Error('expected lights bundle for the fixture');

    // Within budget: 1 placed point + 1 attached torch = 2 point / 0 spot.
    expect(bundle.count).toBe(2);
    expect(() => assertLightBudget(authored.lights)).not.toThrow();

    const lamp = firstMapLight(scene, (l) => {
      const p = l as THREE.PointLight;
      return p.isPointLight === true && p.distance === PLACED_LAMP.range;
    }) as THREE.PointLight;

    expect(lamp).toBeInstanceOf(THREE.PointLight);
    expect(lamp.color.getHexString()).toBe(PLACED_LAMP.color.slice(1));
    expect(lamp.intensity).toBeCloseTo(PLACED_LAMP.intensity);
    expect(lamp.distance).toBeCloseTo(PLACED_LAMP.range);
    // groundY = baseElevation * heightUnit (flat regions) + height * heightUnit
    const expectedY =
      FLOOR_BASE_ELEVATION * HEIGHT_UNIT + (PLACED_LAMP.height as number) * HEIGHT_UNIT;
    expect(lamp.position.x).toBeCloseTo(
      tileCenterToWorld(PLACED_LAMP.x as number, TILE_WORLD_SIZE),
    );
    expect(lamp.position.z).toBeCloseTo(
      tileCenterToWorld(PLACED_LAMP.y as number, TILE_WORLD_SIZE),
    );
    expect(lamp.position.y).toBeCloseTo(expectedY);

    bundle.dispose();
  });

  it('Mode 3 (player-attached): torch exists and updatePlayer tracks position + offset', async () => {
    const { authored } = await loadFixtureAuthoredMap();
    if (!authored) throw new Error('the fixture map must load');
    const floorSource = authored.floorSources[0];
    if (!floorSource) throw new Error('expected one floor source');

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
    const bundle = buildMapLights({
      lights: authored.lights,
      scene,
      floors,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      npcPositions: new Map(),
    });
    if (!bundle) throw new Error('expected lights bundle');

    const torch = firstMapLight(scene, (l) => {
      const p = l as THREE.PointLight;
      return p.isPointLight === true && p.distance === PLAYER_TORCH.range;
    }) as THREE.PointLight;

    // Initial pose is origin + attach offset until the first updatePlayer tick.
    const attachOffsetY = 0.5 * HEIGHT_UNIT;
    expect(torch.position.x).toBeCloseTo(0);
    expect(torch.position.z).toBeCloseTo(0);
    expect(torch.position.y).toBeCloseTo(attachOffsetY);

    const before = torch.position.clone();
    bundle.updatePlayer(new THREE.Vector3(10, 4, 12));
    expect(torch.position.x).not.toBeCloseTo(before.x);
    expect(torch.position.z).not.toBeCloseTo(before.z);
    expect(torch.position.x).toBeCloseTo(10);
    expect(torch.position.z).toBeCloseTo(12);
    expect(torch.position.y).toBeCloseTo(4 + attachOffsetY);

    const mid = torch.position.clone();
    bundle.updatePlayer(new THREE.Vector3(-3, 1, 7));
    expect(torch.position.x).not.toBeCloseTo(mid.x);
    expect(torch.position.z).not.toBeCloseTo(mid.z);
    expect(torch.position.x).toBeCloseTo(-3);
    expect(torch.position.z).toBeCloseTo(7);
    expect(torch.position.y).toBeCloseTo(1 + attachOffsetY);

    bundle.dispose();
  });

  it('Lit interplay: authored lights → lit ambient π; chunk meshes carry normal + uv1', async () => {
    const { authored } = await loadFixtureAuthoredMap();
    if (!authored) throw new Error('the fixture map must load');
    const floorSource = authored.floorSources[0];
    if (!floorSource) throw new Error('expected one floor source');

    expect(mapHasAuthoredLights(authored.lights)).toBe(true);
    expect(baseSceneLightSetup(true)).toEqual({
      ambient: { color: 0xffffff, intensity: Math.PI },
      directional: null,
    });

    // Ensure the translated map still has painted tiles for mesh geometry.
    const painted = floorSource.map.layers.tileLayers[0]?.filter((id) => id !== 0) ?? [];
    expect(painted.length).toBeGreaterThanOrEqual(2);

    const tileset = {
      ...floorSource.tileset,
      sheetNames: { ...floorSource.tileset.sheetNames, B: 'B' },
    };
    const chunks = buildChunks(
      floorSource.map,
      tileset,
      SHEET_48,
      16,
      undefined,
      [],
      floorSource.tilePixelSize ?? 48,
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.tiles.length > 0)).toBe(true);

    const lighting = buildSheetLightingOptions(true, floorSource.lightMapTexture);
    const materials = createSheetMaterials({ B: new THREE.Texture() }, {}, lighting);

    for (const chunk of chunks) {
      if (chunk.tiles.length === 0) continue;
      const group = buildChunkGroup(chunk, materials, {
        tileWorldSize: TILE_WORLD_SIZE,
        heightUnit: HEIGHT_UNIT,
        mapWidthTiles: MAP_SIZE,
        mapHeightTiles: MAP_SIZE,
      });
      expect(group.children.length).toBeGreaterThan(0);
      for (const child of group.children) {
        expect(child).toBeInstanceOf(THREE.Mesh);
        const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv1 = geometry.getAttribute('uv1');
        expect(normal, `mesh ${child.name} missing normal (lit merge)`).toBeDefined();
        expect(normal.itemSize).toBe(3);
        expect(normal.count).toBe(position.count);
        expect(uv1, `mesh ${child.name} missing uv1 (lightmap channel)`).toBeDefined();
        expect(uv1.itemSize).toBe(2);
        expect(uv1.count).toBe(position.count);
      }
    }
  });

  it('Budget edge: 8 placed points + player torch (9 total) fails loudly counting attached', () => {
    const eightPlaced: LightDocument[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      kind: 'point' as const,
      color: '#ffffff',
      intensity: 1,
      range: 4,
      x: i % MAP_SIZE,
      y: 0,
      floor: 'floor-0',
    }));
    const overBudget = fixtureMapDocument([...eightPlaced, PLAYER_TORCH]);
    expect(overBudget.lights).toHaveLength(9);

    // Gate counts every point light — attached torch is included (9/8).
    expect(() => assertLightBudget(overBudget.lights)).toThrow(/point 9\/8/);
    expect(() =>
      buildMapLights({
        lights: overBudget.lights,
        scene: new THREE.Scene(),
        floors: [
          buildFloorGameplay(
            'floor-0',
            FLOOR_BASE_ELEVATION,
            {
              id: 1,
              displayName: 'synthetic',
              width: MAP_SIZE,
              height: MAP_SIZE,
              tilesetId: 1,
              scrollType: 0,
              layers: {
                tileLayers: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
                shadows: emptyLayer(),
                regions: emptyLayer(),
              },
            },
            {
              id: 1,
              name: 'synthetic',
              sheetNames: {
                A1: '',
                A2: '',
                A3: '',
                A4: '',
                A5: '',
                B: '',
                C: '',
                D: '',
                E: '',
              },
              flags: [],
            },
          ),
        ],
        tileWorldSize: TILE_WORLD_SIZE,
        heightUnit: HEIGHT_UNIT,
        npcPositions: new Map(),
      }),
    ).toThrow(/point 9\/8/);
  });
});
