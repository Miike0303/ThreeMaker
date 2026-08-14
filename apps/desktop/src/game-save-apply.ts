/**
 * Pure pre-apply checks for a game save (C3/C4).
 *
 * Document parse already enforces types; the host still must reject saves
 * whose map/placement cannot be realized — never teleport into garbage.
 * Session stores (world/inventory/stats) are pre-validated then applied
 * together so a bad stats/inventory payload never half-mutates.
 */

import {
  type InkStoryRegistry,
  type RestoreInkStoryStatesResult,
  restoreInkStoryStates,
} from '@threemaker/narrative';
import type { GameSaveSnapshot, SaveWorldValue } from '@threemaker/save';

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

export type ApplySessionStoresResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'inventory-invalid' | 'stats-unknown' | 'stats-invalid';
      readonly message: string;
    };

/** Duck-typed session stores — keeps this module free of WorldState class deps. */
export type GameSaveSessionStores = {
  readonly world: {
    replaceAll(values: Readonly<Record<string, SaveWorldValue>>): void;
  };
  readonly inventory: {
    replaceAll(counts: Readonly<Record<string, number>>): void;
  };
  readonly stats: {
    replaceAll(values: Readonly<Record<string, number>>): void;
    definitions(): readonly { readonly id: string }[];
  };
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

/**
 * Pre-validate inventory counts and stat ids against the live session, then
 * replace world / inventory / stats. Validation runs before any mutation so a
 * corrupt payload never half-applies (e.g. world replaced but stats throw).
 *
 * Apply order after validation is inventory → stats → world. Inventory and
 * stats are the ones that throw on bad payloads; world.replaceAll is always
 * safe for a parse-validated record. Mutating the throwing stores first after
 * pre-check is defensive; the pre-check is what actually prevents half-apply.
 */
export function applyGameSaveSessionStores(
  snap: {
    readonly world: Readonly<Record<string, SaveWorldValue>>;
    readonly inventory: Readonly<Record<string, number>>;
    readonly stats: Readonly<Record<string, number>>;
  },
  stores: GameSaveSessionStores,
): ApplySessionStoresResult {
  for (const [itemId, count] of Object.entries(snap.inventory)) {
    if (
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      return {
        ok: false,
        reason: 'inventory-invalid',
        message: `Save inventory count for ${JSON.stringify(itemId)} must be a non-negative integer, got ${String(count)}.`,
      };
    }
  }

  const knownStats = new Set(stores.stats.definitions().map((d) => d.id));
  for (const [statId, value] of Object.entries(snap.stats)) {
    if (!knownStats.has(statId)) {
      return {
        ok: false,
        reason: 'stats-unknown',
        message: `Save stats include unknown stat id ${JSON.stringify(statId)}.`,
      };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return {
        ok: false,
        reason: 'stats-invalid',
        message: `Save stats value for ${JSON.stringify(statId)} must be finite, got ${String(value)}.`,
      };
    }
  }

  // All checks passed — commit every store.
  stores.inventory.replaceAll(snap.inventory);
  stores.stats.replaceAll(snap.stats);
  stores.world.replaceAll(snap.world);
  return { ok: true };
}

/**
 * Restore ink story cursors/variables into the live per-map registry.
 * Must run AFTER the narrative bundle is rebuilt (load disposes and
 * recompiles stories). Skipped ids are logged once — silence would hide
 * real content drift.
 */
export function applyGameSaveStoryStates(
  stories: InkStoryRegistry,
  saved: Readonly<Record<string, string>>,
): RestoreInkStoryStatesResult {
  const result = restoreInkStoryStates(stories, saved);
  if (result.skipped.length > 0) {
    console.warn(`game-save: skipped restoring ink story state for: ${result.skipped.join(', ')}`);
  }
  return result;
}
