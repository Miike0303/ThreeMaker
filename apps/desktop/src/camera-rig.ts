import type { Direction } from '@threemaker/gameplay';
import { clampRange } from './clamp.js';

/** The 3 selectable camera behaviors, cycled at runtime with the 'c' key (see main.ts). */
export type CameraMode = 'hd2d' | 'top-down' | 'first-person';

const CAMERA_MODE_CYCLE: readonly CameraMode[] = ['hd2d', 'top-down', 'first-person'];

/** Runtime-adjustable camera knobs; which of these a mode actually reads is documented per-mode below. */
export interface CameraRigParams {
  /** HD-2D tilt angle in degrees above the horizon. Only read by `'hd2d'` -- `'top-down'` uses its own fixed `TOP_DOWN_TILT_DEG` preset and `'first-person'` has no tilt concept. */
  readonly tiltDeg: number;
  /** Boom distance from the target, in world units. Read by both `'hd2d'` and `'top-down'`; ignored by `'first-person'` (the camera sits directly at the target). */
  readonly distance: number;
  readonly fovDeg: number;
}

/** Where the rig follows: the character's current world position and which way it's facing (for first-person look direction). */
export interface CameraFollowTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: Direction;
}

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly position: Vec3Like;
  readonly lookAt: Vec3Like;
  readonly fovDeg: number;
  /** Whether the character sprite should be hidden this frame (true only in first-person -- the camera sits at the character's own head). */
  readonly hideCharacter: boolean;
  /** Whether depth-of-field focus should be pushed far away instead of tracking the character (true only in first-person, so FP view doesn't blur everything close to the camera). */
  readonly focusFar: boolean;
}

/** Tilt angle clamp for the HD-2D mode's runtime `[`/`]` adjustment (main.ts). */
export const MIN_TILT_DEG = 15;
export const MAX_TILT_DEG = 75;

/** Fixed near-vertical tilt preset for `'top-down'` mode -- not exactly 90 to avoid a degenerate straight-down lookAt (position.x/z would collapse onto lookAt.x/z, but a perspective camera still resolves that fine; kept slightly off purely so the offset math stays a well-conditioned sin/cos pair instead of relying on exact 90 degree edge values). */
export const TOP_DOWN_TILT_DEG = 85;

/** First-person camera height above the character's own ground/feet position, in tile-height units (this codebase's world unit == 1 tile, see `TILE_WORLD_SIZE` in main.ts). Roughly eye height on a 1-tile-tall character. */
export const FIRST_PERSON_HEAD_HEIGHT_TILES = 0.8;

/** How far ahead (world units) the first-person look-at point sits, so `lookAt` is never exactly equal to `position` (which would make `camera.lookAt` a no-op / undefined orientation). */
const FIRST_PERSON_LOOK_AHEAD = 1;

const FACING_DIRECTION: Record<Direction, { readonly x: number; readonly z: number }> = {
  // Map-space convention shared with the renderer (see elevation.ts's
  // EDGE_DELTA): "up"/north is smaller tileY/world Z, "down"/south is larger.
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

/** Clamps `deg` into `[MIN_TILT_DEG, MAX_TILT_DEG]`; `NaN` clamps to the lower bound (see `clampRange`). */
export function clampTiltDeg(deg: number): number {
  return clampRange(deg, MIN_TILT_DEG, MAX_TILT_DEG);
}

/** hd2d/top-down share this: a boom camera at `tiltDeg` above the horizon, `distance` away, looking straight at the target. */
function computeTiltedPose(
  tiltDeg: number,
  distance: number,
  fovDeg: number,
  target: CameraFollowTarget,
): CameraPose {
  const tiltRad = (tiltDeg * Math.PI) / 180;
  return {
    position: {
      x: target.x,
      y: target.y + distance * Math.sin(tiltRad),
      z: target.z + distance * Math.cos(tiltRad),
    },
    lookAt: { x: target.x, y: target.y, z: target.z },
    fovDeg,
    hideCharacter: false,
    focusFar: false,
  };
}

function computeFirstPersonPose(fovDeg: number, target: CameraFollowTarget): CameraPose {
  const position: Vec3Like = {
    x: target.x,
    y: target.y + FIRST_PERSON_HEAD_HEIGHT_TILES,
    z: target.z,
  };
  const dir = FACING_DIRECTION[target.facing];
  return {
    position,
    lookAt: {
      x: position.x + dir.x * FIRST_PERSON_LOOK_AHEAD,
      y: position.y,
      z: position.z + dir.z * FIRST_PERSON_LOOK_AHEAD,
    },
    fovDeg,
    hideCharacter: true,
    focusFar: true,
  };
}

/**
 * Computes the camera's world position/lookAt/fov for one frame, given the
 * active `mode`, the current runtime-adjustable `params`, and the character
 * `target` it follows. Pure function of its inputs -- no three.js Camera
 * object touched here; `main.ts` applies the returned `CameraPose` to the
 * real `THREE.PerspectiveCamera` (and to `CharacterSprite.mesh.visible` /
 * the HD-2D pipeline's DoF focus distance) every frame.
 */
export function computeCameraPose(
  mode: CameraMode,
  params: CameraRigParams,
  target: CameraFollowTarget,
): CameraPose {
  switch (mode) {
    case 'hd2d':
      return computeTiltedPose(params.tiltDeg, params.distance, params.fovDeg, target);
    case 'top-down':
      return computeTiltedPose(TOP_DOWN_TILT_DEG, params.distance, params.fovDeg, target);
    case 'first-person':
      return computeFirstPersonPose(params.fovDeg, target);
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unknown camera mode: ${String(exhaustive)}`);
    }
  }
}

/** Advances to the next mode in the fixed `'hd2d' -> 'top-down' -> 'first-person' -> 'hd2d'` cycle (the 'c' key in main.ts). */
export function cycleCameraMode(mode: CameraMode): CameraMode {
  const nextIndex = (CAMERA_MODE_CYCLE.indexOf(mode) + 1) % CAMERA_MODE_CYCLE.length;
  return CAMERA_MODE_CYCLE[nextIndex] ?? 'hd2d';
}
