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
