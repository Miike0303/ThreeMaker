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
