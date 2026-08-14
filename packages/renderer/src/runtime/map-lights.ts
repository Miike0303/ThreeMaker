/**
 * Per-map authored lights runtime (C6 lighting / WU-03): builds `LightDocument`
 * entries into one `map-lights` group under the shared scene, enforces the
 * WebGL2-floor budget, places / attaches lights, and owns hop-safe disposal.
 *
 * Intermediate visual state (until WU-05 lit tile materials + WU-04 clustered
 * WebGPU): three's default lights only visibly affect glTF props (standard
 * materials); baked `lightMap` textures affect tiles via the renderer sheet
 * materials. That split is expected for this work unit.
 *
 * Mirrors `map-props.ts` lifecycle: empty input → `undefined`, loud budget /
 * attach failures (never silent drop), idempotent `dispose()`.
 */

import type { LightDocument } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import type { FloorElevationSource } from './floor-elevation-source.js';
import { groundYAt } from './ground-y.js';
import type { LightBudget } from './light-budget.js';
import { LIGHT_BUDGET } from './light-budget.js';
import { tileCenterToWorld } from './tile-world.js';

/** World position of an NPC used to place attached lights once at build time. */
export interface NpcLightAnchor {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly groundY: number;
}

export interface MapLightsBundleDeps {
  /** Validated lights from the authored map document (empty → no bundle). */
  readonly lights: readonly LightDocument[];
  readonly scene: {
    add(object: THREE.Object3D): void;
    remove(object: THREE.Object3D): void;
  };
  /** Session floors keyed by array index; each carries `floorId` for placed-light elevation. */
  readonly floors: readonly FloorElevationSource[];
  readonly tileWorldSize: number;
  readonly heightUnit: number;
  /**
   * Runtime NPC anchors keyed by `npcDocument.id`. Attached lights resolve
   * against this map; a missing id is a loud build error (schema already
   * validated against the document — this is the runtime cross-check).
   */
  readonly npcPositions: ReadonlyMap<string, NpcLightAnchor>;
  /** Defaults to {@link LIGHT_BUDGET} (WebGL2 floor). */
  readonly budget?: LightBudget;
}

export interface MapLightsBundle {
  /** Number of light instances in the group. */
  readonly count: number;
  /**
   * Repositions every `attach: 'player'` light to the character mesh position
   * plus a fixed torch offset (`0.5 * heightUnit` above the sprite base).
   */
  updatePlayer(pos: THREE.Vector3): void;
  /**
   * Repositions every light with `attach: npcId` to `pos` plus the same torch
   * offset as {@link MapLightsBundle.updatePlayer}. No-op for unknown npcIds
   * (and after dispose).
   */
  updateNpc(npcId: string, pos: THREE.Vector3): void;
  /**
   * Removes the `map-lights` group from the scene. Lights have no geometry or
   * textures to free — only the group membership is released. Idempotent.
   */
  dispose(): void;
}

/** Default spot cone half-angle (radians). Cone params deferred per schema doc. */
const DEFAULT_SPOT_ANGLE = Math.PI / 6;

/**
 * Torch offset above sprite base for attached lights (player + npc).
 * Exported so callers never re-state the magic `0.5` when documenting parity;
 * positioning still applies the offset inside the bundle.
 */
export const ATTACH_HEIGHT_FACTOR = 0.5;

/** Default placed-light height in height units when the document omits `height`. */
const DEFAULT_PLACED_HEIGHT = 1;

function countByKind(lights: readonly LightDocument[]): { point: number; spot: number } {
  let point = 0;
  let spot = 0;
  for (const light of lights) {
    if (light.kind === 'point') point += 1;
    else spot += 1;
  }
  return { point, spot };
}

/**
 * Loud budget gate — runs before any THREE objects are created so an oversize
 * map never half-loads lights into the shared scene.
 */
export function assertLightBudget(
  lights: readonly LightDocument[],
  budget: LightBudget = LIGHT_BUDGET,
): void {
  const { point, spot } = countByKind(lights);
  if (point > budget.maxPoint || spot > budget.maxSpot) {
    throw new Error(
      `map-lights: authored lights exceed the WebGL2-floor budget ` +
        `(point ${point}/${budget.maxPoint}, spot ${spot}/${budget.maxSpot}).`,
    );
  }
}

function lightGroundY(floorId: string, x: number, y: number, deps: MapLightsBundleDeps): number {
  const floor = deps.floors.find((entry) => entry.floorId === floorId);
  if (!floor) {
    throw new Error(
      `map-lights: no floor with id ${JSON.stringify(floorId)} (have ${deps.floors.map((f) => f.floorId).join(', ') || 'none'}).`,
    );
  }
  return groundYAt(floor.elevation, x, y, deps.heightUnit, floor.baseElevation);
}

function createThreeLight(doc: LightDocument): THREE.PointLight | THREE.SpotLight {
  const color = new THREE.Color(doc.color);
  // No shadows this WU: budget/perf call — castShadow stays false everywhere.
  if (doc.kind === 'spot') {
    // Cone params deferred per schema doc: aim straight down, default cone ~π/6.
    const spot = new THREE.SpotLight(color, doc.intensity, doc.range, DEFAULT_SPOT_ANGLE);
    spot.castShadow = false;
    return spot;
  }
  const point = new THREE.PointLight(color, doc.intensity, doc.range);
  point.castShadow = false;
  return point;
}

/**
 * Builds this map's light instances, or returns `undefined` when the map authors
 * none — same empty contract as `buildMapProps` / `buildMapNarrativeBundle`.
 */
export function buildMapLights(deps: MapLightsBundleDeps): MapLightsBundle | undefined {
  if (deps.lights.length === 0) return undefined;

  const budget = deps.budget ?? LIGHT_BUDGET;
  assertLightBudget(deps.lights, budget);

  const group = new THREE.Group();
  group.name = 'map-lights';
  const playerLights: THREE.Light[] = [];
  /** `attach: '<npcId>'` lights, keyed for {@link MapLightsBundle.updateNpc}. */
  const npcLights = new Map<string, THREE.Light[]>();

  try {
    for (const doc of deps.lights) {
      const light = createThreeLight(doc);

      if (doc.attach !== undefined) {
        const offsetY = ATTACH_HEIGHT_FACTOR * deps.heightUnit;
        if (doc.attach === 'player') {
          // Positioned by `updatePlayer` each frame; initial pose is origin until first tick.
          light.position.set(0, offsetY, 0);
          playerLights.push(light);
        } else {
          const anchor = deps.npcPositions.get(doc.attach);
          if (!anchor) {
            throw new Error(
              `map-lights: light ${JSON.stringify(doc.id)} attaches to unknown npc id ${JSON.stringify(doc.attach)}.`,
            );
          }
          light.position.set(
            tileCenterToWorld(anchor.x, deps.tileWorldSize),
            anchor.groundY + offsetY,
            tileCenterToWorld(anchor.y, deps.tileWorldSize),
          );
          const list = npcLights.get(doc.attach);
          if (list) list.push(light);
          else npcLights.set(doc.attach, [light]);
        }
      } else {
        // Placed form: schema guarantees x/y/floor when attach is absent.
        const x = doc.x as number;
        const y = doc.y as number;
        const floorId = doc.floor as string;
        const groundY = lightGroundY(floorId, x, y, deps);
        const height = doc.height ?? DEFAULT_PLACED_HEIGHT;
        light.position.set(
          tileCenterToWorld(x, deps.tileWorldSize),
          groundY + height * deps.heightUnit,
          tileCenterToWorld(y, deps.tileWorldSize),
        );
      }

      if (light instanceof THREE.SpotLight) {
        // Aim straight down from the light's current position.
        light.target.position.set(light.position.x, light.position.y - 1, light.position.z);
        group.add(light.target);
      }

      group.add(light);
    }
    deps.scene.add(group);
  } catch (error) {
    deps.scene.remove(group);
    throw error;
  }

  let disposed = false;
  const count = deps.lights.length;
  const attachOffsetY = ATTACH_HEIGHT_FACTOR * deps.heightUnit;

  function placeAttached(light: THREE.Light, pos: THREE.Vector3): void {
    light.position.set(pos.x, pos.y + attachOffsetY, pos.z);
    if (light instanceof THREE.SpotLight) {
      light.target.position.set(light.position.x, light.position.y - 1, light.position.z);
    }
  }

  return {
    get count() {
      return count;
    },

    updatePlayer(pos: THREE.Vector3) {
      if (disposed) return;
      for (const light of playerLights) placeAttached(light, pos);
    },

    updateNpc(npcId: string, pos: THREE.Vector3) {
      if (disposed) return;
      const lights = npcLights.get(npcId);
      if (!lights) return;
      for (const light of lights) placeAttached(light, pos);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Lights have no geometry/textures to free — only remove the group.
      deps.scene.remove(group);
    },
  };
}
