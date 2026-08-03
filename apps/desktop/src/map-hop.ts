/**
 * Pure map-hop policy for the desktop runtime.
 *
 * Extracted from `main.ts`'s manifest `G` cycle so the mid-script refusal
 * (C1a R6) and hop-in-flight / stair-traversal guards have an honest test
 * seam. C1b transfer commands will call the same guards before a third
 * swap path is added — do not re-inline these checks.
 *
 * This module is deliberately free of Three.js, Tauri, and DOM so vitest
 * (`environment: 'node'`) can drive it without a browser.
 */

/** Coarse interpreter states that block a hop (must stay idle). */
export type HopInterpreterState =
  | 'idle'
  | 'running'
  | 'waiting-for-dialogue'
  | 'waiting-for-choice';

export type MapHopGuardInput = {
  /** True for the whole duration of an in-flight async hop (load → dispose → rebuild). */
  readonly hopInFlight: boolean;
  /** Current event interpreter state, or `idle` when no narrative bundle is live. */
  readonly interpreterState: HopInterpreterState;
  /** True while a stair traversal walker owns the character. */
  readonly activeTraversal: boolean;
};

export type MapHopRefusal = 'hop-in-flight' | 'interpreter-busy' | 'traversal-active';

export type MapHopGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MapHopRefusal };

/**
 * Whether a map hop may begin right now.
 *
 * Priority (matches the historical `main.ts` order, with hop-in-flight first
 * so a second keypress cannot race an already-started hop):
 * 1. hop already in flight
 * 2. interpreter not idle (mid-script refusal — C1a R6)
 * 3. stair traversal active
 */
export function canBeginMapHop(input: MapHopGuardInput): MapHopGuardResult {
  if (input.hopInFlight) return { ok: false, reason: 'hop-in-flight' };
  if (input.interpreterState !== 'idle') return { ok: false, reason: 'interpreter-busy' };
  if (input.activeTraversal) return { ok: false, reason: 'traversal-active' };
  return { ok: true };
}

/**
 * Next index into a manifest map list when cycling forward, wrapping at the end.
 * `mapCount` must be ≥ 1 (a zero-length manifest has no cycle to advance).
 */
export function nextManifestMapIndex(currentIndex: number, mapCount: number): number {
  if (!Number.isInteger(mapCount) || mapCount < 1) {
    throw new Error(`nextManifestMapIndex: mapCount must be a positive integer, got ${mapCount}.`);
  }
  if (!Number.isInteger(currentIndex) || currentIndex < 0) {
    throw new Error(
      `nextManifestMapIndex: currentIndex must be a non-negative integer, got ${currentIndex}.`,
    );
  }
  return (currentIndex + 1) % mapCount;
}

/** Minimal manifest entry shape needed to resolve a `transferMap.mapFile`. */
export type ManifestMapFileEntry = {
  readonly file: string;
};

export type ManifestMapLookupRefusal = 'not-in-manifest' | 'ambiguous-basename';

export type ManifestMapLookupResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly reason: ManifestMapLookupRefusal };

/** Normalize path separators so authored Windows paths match POSIX manifest entries. */
function normalizeMapPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function basenameOf(path: string): string {
  const normalized = normalizeMapPath(path);
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/**
 * Resolve a `transferMap` / hop target against `manifest.maps[].file`.
 *
 * Order:
 * 1. Exact path match (after `\` → `/` normalization)
 * 2. Unique basename match (authors often omit the game-folder prefix)
 * 3. Otherwise refuse — never pick the first of several basename hits
 */
export function findManifestMapIndex(
  maps: readonly ManifestMapFileEntry[],
  mapFile: string,
): ManifestMapLookupResult {
  if (mapFile.length === 0) return { ok: false, reason: 'not-in-manifest' };

  const wanted = normalizeMapPath(mapFile);
  const exact = maps.findIndex((entry) => normalizeMapPath(entry.file) === wanted);
  if (exact >= 0) return { ok: true, index: exact };

  const wantedBase = basenameOf(wanted);
  if (wantedBase.length === 0) return { ok: false, reason: 'not-in-manifest' };

  const basenameHits: number[] = [];
  for (const [index, entry] of maps.entries()) {
    if (basenameOf(entry.file) === wantedBase) basenameHits.push(index);
  }
  if (basenameHits.length === 1) {
    const only = basenameHits[0];
    if (only === undefined) return { ok: false, reason: 'not-in-manifest' };
    return { ok: true, index: only };
  }
  if (basenameHits.length > 1) return { ok: false, reason: 'ambiguous-basename' };
  return { ok: false, reason: 'not-in-manifest' };
}

/** Facing accepted by `transferMap` / mover.teleport (cardinal only). */
export type TransferFacing = 'up' | 'down' | 'left' | 'right';

/**
 * Early `EventHost.transferMap` gate: whether the host may schedule a hop
 * microtask. Always paired with `done()` so the interpreter returns to idle
 * even on refuse (command is terminal either way).
 *
 * Distinct from {@link canBeginMapHop}: that guard re-runs inside the hop
 * after `done()` (interpreter must be idle). This gate also covers the
 * single-map case where no hop function is installed at all.
 */
export type TransferMapHostInput = {
  /** True when multi-map hop machinery is installed (`manifest.maps.length > 1`). */
  readonly hopPathActive: boolean;
  /** True for the whole async hop duration (same flag as canBeginMapHop). */
  readonly hopInFlight: boolean;
  /** True while a stair traversal walker owns the character. */
  readonly activeTraversal: boolean;
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly facing?: TransferFacing;
};

export type TransferMapHostRefusal = 'no-hop-path' | 'hop-in-flight' | 'traversal-active';

export type TransferMapArrival = {
  readonly x: number;
  readonly y: number;
  readonly facing?: TransferFacing;
};

export type TransferMapHostDecision =
  | { readonly ok: true; readonly mapFile: string; readonly arrival: TransferMapArrival }
  | { readonly ok: false; readonly reason: TransferMapHostRefusal };

/**
 * Decide whether `EventHost.transferMap` may queue a hop.
 *
 * Priority:
 * 1. no multi-map hop path installed
 * 2. hop already in flight
 * 3. stair traversal active
 */
export function decideTransferMapHost(input: TransferMapHostInput): TransferMapHostDecision {
  if (!input.hopPathActive) return { ok: false, reason: 'no-hop-path' };
  if (input.hopInFlight) return { ok: false, reason: 'hop-in-flight' };
  if (input.activeTraversal) return { ok: false, reason: 'traversal-active' };

  const arrival: TransferMapArrival =
    input.facing !== undefined
      ? { x: input.x, y: input.y, facing: input.facing }
      : { x: input.x, y: input.y };

  return { ok: true, mapFile: input.mapFile, arrival };
}
