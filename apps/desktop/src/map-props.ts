/**
 * Per-map glTF props runtime (C5 depth-props-hd / WU-03): loads authored
 * `PropDocument` entries into the shared scene, dedupes parses by object sha,
 * places each instance on its floor's ground Y, plays optional animation clips,
 * and owns disposal of every GPU resource the parse created.
 *
 * Mirrors `map-narrative-bundle.ts`'s lifecycle contract: empty input →
 * `undefined` (no bundle), `dispose()` frees exactly what this module created,
 * partial-construction cleanup on mid-build throw so the shared scene never
 * keeps orphan meshes or leaked parse resources.
 */

import type { PropDocument } from '@threemaker/map-format';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';
import { tileCenterToWorld } from './character-sprite.js';
import type { FloorGameplay } from './floor-runtime.js';
import { groundYAt } from './ground-y.js';

/** Result of parsing one glTF / glb blob into a scene graph + clips. */
export interface ParseGltfResult {
  readonly scene: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

export type ParseGltf = (bytes: Uint8Array, pathHint: string) => Promise<ParseGltfResult>;

export interface MapPropsBundleDeps {
  /** Validated props from the authored map document (empty → no bundle). */
  readonly props: readonly PropDocument[];
  /** Scene instances are added to, and removed from on `dispose()`. */
  readonly scene: {
    add(object: THREE.Object3D): void;
    remove(object: THREE.Object3D): void;
  };
  /** Session floors keyed by array index; each carries `floorId` for id→elevation lookup. */
  readonly floors: readonly Pick<FloorGameplay, 'floorId' | 'elevation' | 'baseElevation'>[];
  readonly tileWorldSize: number;
  readonly heightUnit: number;
  /** Content-addressed glb bytes from the asset store (`objects/{aa}/{sha}`). */
  readonly resolveObjectBinary: (sha256: string) => Promise<Uint8Array>;
  /**
   * Injectable parse seam (defaults to {@link parseGltfBytes}). Tests stub this
   * with canned scene graphs so the pure placement/registry/disposal path runs
   * without touching the loader.
   */
  readonly parseGltf?: ParseGltf;
}

export interface MapPropsBundle {
  /** Number of placed prop instances (one per authored prop entry). */
  readonly count: number;
  /** Number of distinct object shas parsed for this map. */
  readonly assetCount: number;
  /** Advances every instance mixer by `dt` seconds. */
  update(dt: number): void;
  /** Removes meshes from the scene and frees parse-owned GPU resources. Idempotent. */
  dispose(): void;
}

/** Shared parse cache entry: one root graph + clips per object sha. */
interface ParsedAsset {
  readonly root: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

/**
 * Real `GLTFLoader.parse` wrapper. Works under vitest/node against a binary
 * glb (no GPU required for parse). Exported so the fixture test can pin the
 * shim itself without going through `buildMapProps`.
 */
export function parseGltfBytes(bytes: Uint8Array, pathHint: string): Promise<ParseGltfResult> {
  const loader = new GLTFLoader();
  // Copy into a fresh ArrayBuffer — `buffer.slice` can type as SharedArrayBuffer
  // under lib.dom, and GLTFLoader.parse only accepts ArrayBuffer | string.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Promise((resolve, reject) => {
    loader.parse(
      copy,
      '',
      (gltf) => {
        resolve({ scene: gltf.scene, animations: gltf.animations ?? [] });
      },
      (error) => {
        reject(
          error instanceof Error
            ? error
            : new Error(`map-props: GLTFLoader.parse failed for ${pathHint}: ${String(error)}`),
        );
      },
    );
  });
}

/** True when any descendant is a `SkinnedMesh` (needs SkeletonUtils.clone). */
function hasSkinnedMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * Drop cameras/lights that ride inside a glb — a prop must never add lights
 * (or cameras) to the shared game scene.
 */
function stripLightsAndCameras(root: THREE.Object3D): void {
  const drop: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Light).isLight || (obj as THREE.Camera).isCamera) drop.push(obj);
  });
  for (const obj of drop) obj.parent?.remove(obj);
}

/** World-space ground Y for a prop on the floor named by `floorId`. */
function propGroundY(floorId: string, x: number, y: number, deps: MapPropsBundleDeps): number {
  const floor = deps.floors.find((entry) => entry.floorId === floorId);
  if (!floor) {
    throw new Error(
      `map-props: no floor with id ${JSON.stringify(floorId)} (have ${deps.floors.map((f) => f.floorId).join(', ') || 'none'}).`,
    );
  }
  return groundYAt(floor.elevation, x, y, deps.heightUnit, floor.baseElevation);
}

function placeInstance(root: THREE.Object3D, prop: PropDocument, deps: MapPropsBundleDeps): void {
  const groundY = propGroundY(prop.floor, prop.x, prop.y, deps);
  root.position.set(
    tileCenterToWorld(prop.x, deps.tileWorldSize),
    groundY,
    tileCenterToWorld(prop.y, deps.tileWorldSize),
  );
  const scale = prop.scale ?? 1;
  root.scale.setScalar(scale);
  root.rotation.y = THREE.MathUtils.degToRad(prop.rotationY ?? 0);
}

/** Dispose every geometry, material, and texture owned by a parsed root (once). */
function disposeParsedRoot(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const mat of list) {
      for (const value of Object.values(mat)) {
        if (
          value &&
          typeof value === 'object' &&
          'isTexture' in value &&
          (value as THREE.Texture).isTexture
        ) {
          (value as THREE.Texture).dispose();
        }
      }
      mat.dispose();
    }
  });
}

function disposeAssets(assets: Map<string, ParsedAsset>): void {
  for (const asset of assets.values()) disposeParsedRoot(asset.root);
  assets.clear();
}

function stopMixers(mixers: THREE.AnimationMixer[]): void {
  for (const mixer of mixers) {
    mixer.stopAllAction();
    // Drop clip bindings so the mixer holds no references to disposed graphs.
    mixer.uncacheRoot(mixer.getRoot());
  }
  mixers.length = 0;
}

/**
 * Builds this map's prop instances, or returns `undefined` when the map authors
 * none — same empty contract as `buildMapNarrativeBundle`.
 *
 * Throws when an authored `animation` names a clip the glTF does not carry:
 * dangling content references never half-load (same spirit as narrative
 * cross-validation).
 */
export async function buildMapProps(deps: MapPropsBundleDeps): Promise<MapPropsBundle | undefined> {
  if (deps.props.length === 0) return undefined;

  const parseGltf = deps.parseGltf ?? parseGltfBytes;
  const assets = new Map<string, ParsedAsset>();

  // Deduped by sha WITHIN this map, so two props sharing one glb parse once.
  const uniqueShas = [...new Set(deps.props.map((entry) => entry.object))];
  try {
    await Promise.all(
      uniqueShas.map(async (sha256) => {
        const bytes = await deps.resolveObjectBinary(sha256);
        const parsed = await parseGltf(bytes, sha256);
        // Strip before any instance clones so lights never reach the scene.
        stripLightsAndCameras(parsed.scene);
        assets.set(sha256, { root: parsed.scene, animations: parsed.animations });
      }),
    );
  } catch (error) {
    disposeAssets(assets);
    throw error;
  }

  const group = new THREE.Group();
  group.name = 'map-props';
  const mixers: THREE.AnimationMixer[] = [];

  try {
    for (const prop of deps.props) {
      const asset = assets.get(prop.object);
      if (!asset) {
        throw new Error(`map-props: unresolved object ${prop.object}.`);
      }

      // SkeletonUtils when skinned (preserves bone hierarchy); plain clone otherwise.
      const instance = hasSkinnedMesh(asset.root)
        ? (SkeletonUtils.clone(asset.root) as THREE.Object3D)
        : asset.root.clone(true);

      // Placement can throw on a missing floor id — track nothing on the shared
      // scene until the whole loop succeeds (group is added only after).
      placeInstance(instance, prop, deps);
      group.add(instance);

      if (prop.animation !== undefined) {
        const clip = asset.animations.find((entry) => entry.name === prop.animation);
        if (!clip) {
          throw new Error(
            `map-props: prop ${JSON.stringify(prop.id)} references missing animation clip ${JSON.stringify(prop.animation)}.`,
          );
        }
        // One mixer per INSTANCE (never per shared root) so independent playback works.
        const mixer = new THREE.AnimationMixer(instance);
        mixer.clipAction(clip).play();
        mixers.push(mixer);
      }
    }
    deps.scene.add(group);
  } catch (error) {
    // Partial construction is not recoverable, but it is still ours to clean up:
    // the returned bundle (and its dispose) never exists on a throw path.
    deps.scene.remove(group);
    stopMixers(mixers);
    disposeAssets(assets);
    throw error;
  }

  let disposed = false;
  const count = deps.props.length;
  const assetCount = assets.size;

  return {
    get count() {
      return count;
    },
    get assetCount() {
      return assetCount;
    },

    update(dt: number) {
      if (disposed) return;
      for (const mixer of mixers) mixer.update(dt);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      deps.scene.remove(group);
      stopMixers(mixers);
      // Shared parse roots disposed once — instance clones share geometry/materials.
      disposeAssets(assets);
    },
  };
}
