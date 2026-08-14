/**
 * Per-map glTF props runtime (C5 WU-03): placement, sha-deduped parse registry,
 * skinned vs plain clone, animation mixer lifecycle, light/camera stripping,
 * disposal (including partial-construction cleanup), and the real
 * `GLTFLoader.parse` shim against the committed tiny .glb fixture.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElevationField } from '@threemaker/gameplay';
import type { PropDocument } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { MapPropsBundleDeps, ParseGltfResult } from '../src/runtime/map-props.js';
import { buildMapProps, parseGltfBytes } from '../src/runtime/map-props.js';
import { tileCenterToWorld } from '../src/runtime/tile-world.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'props');
const CUBE_SPIN_GLB = readFileSync(join(FIXTURE_DIR, 'cube-spin.glb'));
const PROP_SHA_A = 'a'.repeat(64);
const PROP_SHA_B = 'b'.repeat(64);

function floorAt(height: number, baseElevation: number, floorId = 'floor-0') {
  return {
    floorId,
    elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(height))),
    baseElevation,
  };
}

function prop(overrides: Partial<PropDocument> & Pick<PropDocument, 'id'>): PropDocument {
  return {
    x: 1,
    y: 2,
    floor: 'floor-0',
    object: PROP_SHA_A,
    ...overrides,
  };
}

/** Canned static mesh graph (no skin, no lights). */
function cannedMeshScene(name = 'PropMesh'): ParseGltfResult {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  vi.spyOn(geometry, 'dispose');
  vi.spyOn(material, 'dispose');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  const scene = new THREE.Group();
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('spin', 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0]),
      ]),
      new THREE.AnimationClip('idle', 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      ]),
    ],
  };
}

/** Canned skinned graph so the SkeletonUtils.clone path is chosen. */
function cannedSkinnedScene(): ParseGltfResult {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x444444 });
  vi.spyOn(geometry, 'dispose');
  vi.spyOn(material, 'dispose');
  const bone = new THREE.Bone();
  bone.name = 'rootBone';
  const skeleton = new THREE.Skeleton([bone]);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bone);
  mesh.bind(skeleton);
  const scene = new THREE.Group();
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('walk', 1, [
        new THREE.VectorKeyframeTrack('.bones[rootBone].position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
      ]),
    ],
  };
}

/** Graph that carries a DirectionalLight and a PerspectiveCamera (must be stripped). */
function cannedSceneWithExtras(): ParseGltfResult {
  const base = cannedMeshScene('WithExtras');
  base.scene.add(new THREE.DirectionalLight(0xffffff, 1));
  base.scene.add(new THREE.PerspectiveCamera(50, 1, 0.1, 100));
  return base;
}

function trackDispose(result: ParseGltfResult): {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
} {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  result.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      geometries.push(mesh.geometry);
      if (!vi.isMockFunction(mesh.geometry.dispose)) vi.spyOn(mesh.geometry, 'dispose');
    }
    const mat = mesh.material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      materials.push(m);
      if (!vi.isMockFunction(m.dispose)) vi.spyOn(m, 'dispose');
    }
  });
  return { geometries, materials };
}

async function build(
  props: readonly PropDocument[],
  overrides: Partial<MapPropsBundleDeps> = {},
  shared: { scene?: THREE.Scene } = {},
) {
  const scene = shared.scene ?? new THREE.Scene();
  const parseGltf = overrides.parseGltf ?? vi.fn(async () => cannedMeshScene());
  const resolveObjectBinary =
    overrides.resolveObjectBinary ?? vi.fn(async () => new Uint8Array([1, 2, 3]));
  const bundle = await buildMapProps({
    props,
    scene,
    floors: [floorAt(0, 0), floorAt(1, 3, 'floor-1')],
    tileWorldSize: 1,
    heightUnit: 1,
    resolveObjectBinary,
    parseGltf,
    ...overrides,
  });
  return { bundle, scene, parseGltf, resolveObjectBinary };
}

describe('buildMapProps — empty / contract', () => {
  it('returns undefined when props is empty (no scene attachment)', async () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;
    const bundle = await buildMapProps({
      props: [],
      scene,
      floors: [floorAt(0, 0)],
      tileWorldSize: 1,
      heightUnit: 1,
      resolveObjectBinary: async () => new Uint8Array(),
    });
    expect(bundle).toBeUndefined();
    expect(scene.children.length).toBe(before);
  });
});

describe('buildMapProps — placement', () => {
  it('places a prop at tile center with ground Y, uniform scale, and rotationY degrees', async () => {
    const floors = [floorAt(2, 1)]; // surface 2 + base 1 → world Y 3 at heightUnit 1
    const { bundle, scene } = await build(
      [prop({ id: 'lamp', x: 3, y: 4, scale: 2, rotationY: 90 })],
      { floors, tileWorldSize: 2, heightUnit: 1 },
    );
    expect(bundle?.count).toBe(1);

    const root = scene.children[0] as THREE.Object3D;
    // Outer group holds instance roots.
    const instance = root.children[0] as THREE.Object3D;
    expect(instance.position.x).toBeCloseTo(tileCenterToWorld(3, 2));
    expect(instance.position.z).toBeCloseTo(tileCenterToWorld(4, 2));
    expect(instance.position.y).toBeCloseTo(3);
    expect(instance.scale.x).toBeCloseTo(2);
    expect(instance.scale.y).toBeCloseTo(2);
    expect(instance.scale.z).toBeCloseTo(2);
    expect(instance.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('samples ground Y from the prop floor id (not always floor 0)', async () => {
    const floors = [floorAt(0, 0, 'floor-0'), floorAt(0, 5, 'floor-1')];
    const { scene } = await build([prop({ id: 'up', floor: 'floor-1', x: 0, y: 0 })], {
      floors,
      heightUnit: 2,
    });
    const instance = (scene.children[0] as THREE.Object3D).children[0] as THREE.Object3D;
    // baseElevation 5 * heightUnit 2 = 10
    expect(instance.position.y).toBeCloseTo(10);
  });
});

describe('buildMapProps — registry / dedupe / clone path', () => {
  it('parses each distinct object sha once and builds one instance per prop', async () => {
    const parseGltf = vi.fn(async () => cannedMeshScene());
    const resolveObjectBinary = vi.fn(async () => new Uint8Array([9]));
    const { bundle } = await build(
      [
        prop({ id: 'a', object: PROP_SHA_A }),
        prop({ id: 'b', object: PROP_SHA_A }),
        prop({ id: 'c', object: PROP_SHA_B }),
      ],
      { parseGltf, resolveObjectBinary },
    );
    expect(bundle?.count).toBe(3);
    expect(resolveObjectBinary).toHaveBeenCalledTimes(2);
    expect(parseGltf).toHaveBeenCalledTimes(2);
    expect(bundle?.assetCount).toBe(2);
  });

  it('uses SkeletonUtils.clone when the parsed scene contains a SkinnedMesh', async () => {
    const skinned = cannedSkinnedScene();
    const parseGltf = vi.fn(async () => skinned);
    const { scene } = await build([prop({ id: 'npc-prop' })], { parseGltf });
    const instance = (scene.children[0] as THREE.Object3D).children[0] as THREE.Object3D;
    let foundSkinned = false;
    instance.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) foundSkinned = true;
    });
    expect(foundSkinned).toBe(true);
    // Clone is not the same object as the shared parse root.
    expect(instance).not.toBe(skinned.scene);
  });
});

describe('buildMapProps — animation', () => {
  it('plays a named clip on a per-instance mixer when animation is set', async () => {
    const { bundle } = await build([prop({ id: 'spinning', animation: 'spin' })]);
    if (!bundle) throw new Error('expected props bundle');
    // update must not throw; mixer exists (internal).
    bundle.update(0.5);
    bundle.update(0.5);
  });

  it('fails the map load loudly when the named animation clip is missing', async () => {
    await expect(build([prop({ id: 'broken', animation: 'nope' })])).rejects.toThrow(
      /missing animation clip "nope"/i,
    );
  });

  it('creates no mixer when animation is absent', async () => {
    const { bundle, scene } = await build([prop({ id: 'static' })]);
    if (!bundle) throw new Error('expected props bundle');
    expect(bundle.count).toBe(1);
    // Static: update is a no-op (no throw, no motion requirement).
    bundle.update(1);
    const instance = (scene.children[0] as THREE.Object3D).children[0] as THREE.Object3D;
    const y0 = instance.position.y;
    bundle.update(1);
    expect(instance.position.y).toBe(y0);
  });
});

describe('buildMapProps — lights/cameras stripped', () => {
  it('strips lights and cameras from the parsed glTF before instancing', async () => {
    const parseGltf = vi.fn(async () => cannedSceneWithExtras());
    const { scene } = await build([prop({ id: 'lit' })], { parseGltf });
    const group = scene.children[0] as THREE.Object3D;
    let lights = 0;
    let cameras = 0;
    group.traverse((obj) => {
      if ((obj as THREE.Light).isLight) lights += 1;
      if ((obj as THREE.Camera).isCamera) cameras += 1;
    });
    expect(lights).toBe(0);
    expect(cameras).toBe(0);
  });
});

describe('buildMapProps — disposal', () => {
  it('disposes shared parse resources once, removes scene children, and is idempotent', async () => {
    const canned = cannedMeshScene();
    const tracked = trackDispose(canned);
    const parseGltf = vi.fn(async () => canned);
    const scene = new THREE.Scene();
    const sentinel = new THREE.Object3D();
    scene.add(sentinel);

    const { bundle } = await build(
      [prop({ id: 'a' }), prop({ id: 'b' })], // two instances, one asset
      { parseGltf },
      { scene },
    );
    if (!bundle) throw new Error('expected props bundle');
    expect(bundle.count).toBe(2);
    expect(bundle.assetCount).toBe(1);
    expect(scene.children.length).toBe(2); // sentinel + props group

    const geo = tracked.geometries[0];
    const mat = tracked.materials[0];
    if (!geo || !mat) throw new Error('expected tracked geometry/material');

    bundle.dispose();
    expect(scene.children).toEqual([sentinel]);
    expect(geo.dispose).toHaveBeenCalledTimes(1);
    expect(mat.dispose).toHaveBeenCalledTimes(1);

    // Idempotent.
    bundle.dispose();
    expect(geo.dispose).toHaveBeenCalledTimes(1);
  });

  it('partial-construction throw leaves the scene clean and disposes loaded assets', async () => {
    let call = 0;
    const assets: ParseGltfResult[] = [];
    const parseGltf = vi.fn(async () => {
      const r = cannedMeshScene(`m${call++}`);
      trackDispose(r);
      assets.push(r);
      return r;
    });
    const scene = new THREE.Scene();
    const sentinel = new THREE.Object3D();
    scene.add(sentinel);

    await expect(
      build(
        [
          prop({ id: 'ok', object: PROP_SHA_A, animation: 'spin' }),
          prop({ id: 'bad', object: PROP_SHA_B, animation: 'missing-clip' }),
        ],
        { parseGltf },
        { scene },
      ),
    ).rejects.toThrow(/missing animation clip/i);

    expect(scene.children).toEqual([sentinel]);
    for (const asset of assets) {
      asset.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && vi.isMockFunction(mesh.geometry.dispose)) {
          expect(mesh.geometry.dispose).toHaveBeenCalled();
        }
      });
    }
  });
});

describe('parseGltfBytes — loader shim + fixture', () => {
  it('GLTFLoader.parse on the committed cube-spin.glb yields one mesh and the spin clip', async () => {
    const gltf = await parseGltfBytes(new Uint8Array(CUBE_SPIN_GLB), 'cube-spin.glb');
    let meshes = 0;
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes += 1;
    });
    expect(meshes).toBe(1);
    expect(gltf.animations.map((c) => c.name)).toContain('spin');
  });

  it('buildMapProps default parseGltf path loads the fixture binary end-to-end', async () => {
    const scene = new THREE.Scene();
    const bundle = await buildMapProps({
      props: [prop({ id: 'fixture', animation: 'spin' })],
      scene,
      floors: [floorAt(0, 0)],
      tileWorldSize: 1,
      heightUnit: 1,
      resolveObjectBinary: async () => new Uint8Array(CUBE_SPIN_GLB),
      // real default parseGltf (no stub)
    });
    if (!bundle) throw new Error('expected props bundle from fixture glb');
    expect(bundle.count).toBe(1);
    expect(scene.children.length).toBe(1);
    bundle.update(0.016);
    bundle.dispose();
    expect(scene.children.length).toBe(0);
  });
});
