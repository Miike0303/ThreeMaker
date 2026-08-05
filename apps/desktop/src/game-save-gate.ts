/**
 * Pure gates for when the player may save or load (C3 WU-03).
 * Host supplies hop/interpreter/traversal flags already used by map hops.
 */

import type { MapHopGuardInput } from './map-hop.js';
import { canBeginMapHop } from './map-hop.js';

export type SaveGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'hop-in-flight' | 'traversal-active' };

export type LoadGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'hop-in-flight' | 'interpreter-busy' | 'traversal-active';
    };

/**
 * Save is allowed while idle *or* in dialogue/script: tile + world are still
 * consistent. Refuse only mid-hop or mid-stair traversal (session half-swapped
 * or walker-owned — snapshot would be misleading).
 */
export function canSaveGameProgress(input: {
  readonly hopInFlight: boolean;
  readonly activeTraversal: boolean;
}): SaveGateResult {
  if (input.hopInFlight) return { ok: false, reason: 'hop-in-flight' };
  if (input.activeTraversal) return { ok: false, reason: 'traversal-active' };
  return { ok: true };
}

/**
 * Load rebuilds map/bundle — same preconditions as a map hop so we never
 * dispose mid-script or mid-traversal.
 */
export function canLoadGameProgress(input: MapHopGuardInput): LoadGateResult {
  const hop = canBeginMapHop(input);
  if (!hop.ok) return hop;
  return { ok: true };
}
