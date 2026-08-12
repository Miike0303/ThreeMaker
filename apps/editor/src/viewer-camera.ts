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

export interface ZoomBounds {
  readonly min: number;
  readonly max: number;
}

/** Exponential wheel-zoom step: e per ~667 wheel-delta units, tuned for one ~120-delta notch to feel like a gentle ~20% step. */
const ZOOM_WHEEL_SENSITIVITY = 0.0015;

/**
 * Pure wheel-zoom for the painter overview camera (WU-UX-01): scales the
 * current boom distance by an exponential step of the wheel delta (so equal
 * notches apply equal ratios at any distance, and opposite notches cancel),
 * clamped into `bounds`. Positive `wheelDeltaY` (scroll down) zooms OUT.
 */
export function zoomCameraDistance(
  current: number,
  wheelDeltaY: number,
  bounds: ZoomBounds,
): number {
  return clampRange(
    current * Math.exp(wheelDeltaY * ZOOM_WHEEL_SENSITIVITY),
    bounds.min,
    bounds.max,
  );
}

/**
 * Multiplicative button-zoom step (WU-VIEW-02): the on-screen +/- controls
 * apply a fixed ratio per click, clamped into the same bounds as wheel-zoom.
 * Factor > 1 zooms OUT (farther), < 1 zooms IN (closer).
 */
export function zoomCameraDistanceByFactor(
  current: number,
  factor: number,
  bounds: ZoomBounds,
): number {
  return clampRange(current * factor, bounds.min, bounds.max);
}

/**
 * Zoom readout as a percentage of the map's framing distance (WU-VIEW-02):
 * 100% = the whole-map framing `loadMap` resets to, 200% = twice as far
 * (zoomed out), 50% = half as far (zoomed in).
 */
export function zoomPercentForDistance(reference: number, current: number): number {
  if (reference <= 0) return 100;
  return Math.round((reference / current) * 100);
}

export interface CameraPanTarget {
  readonly x: number;
  readonly z: number;
}

/**
 * Pure drag-pan for the painter overview camera (WU-UX-01): converts a
 * screen-pixel drag into a ground-plane (y = 0) offset of the camera's
 * look-at target so content follows the cursor. Derived from the same pose
 * math as `computeOverviewCameraPose`/`projectToScreenFraction`, linearized
 * at the look-at point:
 * - world units per vertical pixel = 2 * distance * tan(fov/2) / viewportHeight
 * - a vertical drag maps along the ground-plane z axis, foreshortened by the
 *   camera tilt (1/sin(tilt); sqrt(2) at the 45-degree overview tilt).
 * The target moves OPPOSITE the drag ("grab the map" semantics).
 */
export function panCameraTarget(
  target: CameraPanTarget,
  screenDx: number,
  screenDy: number,
  distance: number,
  viewportHeight: number,
  fovDeg: number,
  tiltDeg: number,
): CameraPanTarget {
  const worldPerPixel =
    (2 * distance * Math.tan((fovDeg * Math.PI) / 180 / 2)) / Math.max(viewportHeight, 1);
  const tiltRad = (clampRange(tiltDeg, 1, 89) * Math.PI) / 180;
  return {
    x: target.x - screenDx * worldPerPixel,
    z: target.z - (screenDy * worldPerPixel) / Math.sin(tiltRad),
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
 * mirroring this module's other camera math (callers re-project whenever the
 * pose changes: on resize, and on the painter's wheel-zoom/drag-pan, see
 * WU-UX-01's `zoomCameraDistance`/`panCameraTarget`).
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
