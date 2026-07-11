import { clampRange } from './clamp.js';

/**
 * Pure camera-framing math for the (static, non-following) map-viewer
 * overview camera -- mirrors apps/desktop's `focusCameraOnSpawn` distance
 * formula (camera-rig.ts's tilted-pose math), but the viewer has no
 * character to follow: it always frames the whole map from its center.
 */
export function computeOverviewCameraDistance(
  mapWidth: number,
  mapHeight: number,
  distanceFactor: number,
  maxDistance: number,
): number {
  return Math.min(Math.max(mapWidth, mapHeight) * distanceFactor, maxDistance);
}

export interface OverviewCameraPose {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly lookAt: { readonly x: number; readonly y: number; readonly z: number };
}

/** Pure: a fixed-tilt boom camera looking at the map's center, framed by `computeOverviewCameraDistance`. */
export function computeOverviewCameraPose(
  centerX: number,
  centerZ: number,
  tiltDeg: number,
  distance: number,
): OverviewCameraPose {
  const tiltRad = (clampRange(tiltDeg, 1, 89) * Math.PI) / 180;
  return {
    position: {
      x: centerX,
      y: distance * Math.sin(tiltRad),
      z: centerZ + distance * Math.cos(tiltRad),
    },
    lookAt: { x: centerX, y: 0, z: centerZ },
  };
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScreenFraction {
  /** 0 = left edge, 1 = right edge. */
  readonly xFrac: number;
  /** 0 = top edge, 1 = bottom edge. */
  readonly yFrac: number;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * Pure perspective projection of `point` into normalized screen fractions,
 * for the SAME no-roll, world-up-locked camera pose `computeOverviewCameraPose`
 * produces. Lets the painter's display-only ramp-direction glyph overlay
 * (see `ramp-glyph.ts` + `PainterViewport`) place a DOM label over its cell
 * without holding a live `THREE.Camera` -- this stays pure/unit-testable,
 * mirroring this module's other camera math (the overview camera never
 * pans/zooms at runtime, so this projection is stable for a whole session
 * except across a resize, which only changes `aspect`).
 *
 * Returns `undefined` when `point` is behind the camera (nothing to render).
 */
export function projectToScreenFraction(
  point: Vec3,
  pose: OverviewCameraPose,
  fovDeg: number,
  aspect: number,
): ScreenFraction | undefined {
  const forward = normalize(subtract(pose.lookAt, pose.position));
  const right = normalize(cross(forward, WORLD_UP));
  const camUp = cross(right, forward);
  const relative = subtract(point, pose.position);

  const depth = dot(relative, forward);
  if (depth <= 0) return undefined;

  const tanHalfFovY = Math.tan((fovDeg * Math.PI) / 180 / 2);
  const ndcX = dot(relative, right) / (depth * tanHalfFovY * aspect);
  const ndcY = dot(relative, camUp) / (depth * tanHalfFovY);

  return { xFrac: (ndcX + 1) / 2, yFrac: (1 - ndcY) / 2 };
}
