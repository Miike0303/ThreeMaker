/**
 * Pure pre-apply checks for a game save (C3 WU-02).
 *
 * Document parse already enforces types; the host still must reject saves
 * whose map/placement cannot be realized — never teleport into garbage.
 */

import type { GameSaveSnapshot } from '@threemaker/save';

export type MapFileCatalog = {
  /** Map files the running session may load (relative to `.threemaker/maps`). */
  readonly files: readonly string[];
};

export type LoadedMapGeometry = {
  readonly floorCount: number;
  readonly width: number;
  readonly height: number;
};

export type MapFileResolveResult =
  | { readonly ok: true; readonly mapFile: string }
  | { readonly ok: false; readonly reason: 'map-unresolved'; readonly message: string };

export type PlacementValidateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'floor-out-of-range' | 'position-out-of-bounds';
      readonly message: string;
    };

function normalize(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Narrative-bundle arrival after a same-map load.
 * Must be the saved player tile so `TriggerIndex` treats underfoot as already
 * entered (same contract as spawn `initialTile`) — not boot `session.spawn`.
 */
export function sameMapLoadNarrativeArrival(snap: {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}): { readonly x: number; readonly y: number; readonly floor: number } {
  return { x: snap.x, y: snap.y, floor: snap.floor };
}

/**
 * Whether `mapFile` is one of the maps this session can load.
 * Compares normalized full relative paths (not basenames — ambiguous names
 * are not silently matched for save-load).
 */
export function resolveMapFileInCatalog(
  mapFile: string,
  catalog: MapFileCatalog,
): MapFileResolveResult {
  const wanted = normalize(mapFile);
  if (wanted.length === 0) {
    return { ok: false, reason: 'map-unresolved', message: 'Save mapFile is empty.' };
  }
  const hit = catalog.files.some((file) => normalize(file) === wanted);
  if (!hit) {
    return {
      ok: false,
      reason: 'map-unresolved',
      message: `Save mapFile ${JSON.stringify(wanted)} is not available in this session.`,
    };
  }
  return { ok: true, mapFile: wanted };
}

/**
 * After the target map has been loaded into memory (without swapping the
 * live session), check floor/position against that map's geometry.
 */
export function validateSavePlacement(
  snapshot: GameSaveSnapshot,
  geometry: LoadedMapGeometry,
): PlacementValidateResult {
  if (
    !Number.isInteger(geometry.floorCount) ||
    geometry.floorCount < 1 ||
    snapshot.floor < 0 ||
    snapshot.floor >= geometry.floorCount
  ) {
    return {
      ok: false,
      reason: 'floor-out-of-range',
      message: `Save floor ${snapshot.floor} is out of range for a map with ${geometry.floorCount} floor(s).`,
    };
  }
  if (
    !Number.isInteger(geometry.width) ||
    !Number.isInteger(geometry.height) ||
    geometry.width < 1 ||
    geometry.height < 1 ||
    snapshot.x < 0 ||
    snapshot.y < 0 ||
    snapshot.x >= geometry.width ||
    snapshot.y >= geometry.height
  ) {
    return {
      ok: false,
      reason: 'position-out-of-bounds',
      message: `Save position (${snapshot.x}, ${snapshot.y}) is outside map bounds ${geometry.width}x${geometry.height}.`,
    };
  }
  return { ok: true };
}
