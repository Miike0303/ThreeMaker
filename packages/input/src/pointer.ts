import type { ActionEdge } from './keyboard.js';
import { Actions } from './types.js';

/**
 * Pure pointer sample — host supplies a logical hit target after its own
 * hit-test. No DOM / PointerEvent types so vitest can drive this under node.
 */
export type PointerPhase = 'down' | 'up';

/**
 * Where the pointer landed, as classified by the host:
 * - `actionable` — game canvas or dialogue body → remappable `interact`
 * - `choice` — a dialogue option row (index is host hit-test, not ActionId)
 * - `ignored` — chrome that must not fire gameplay (debug panel, etc.)
 */
export type PointerHitTarget =
  | { readonly kind: 'actionable' }
  | { readonly kind: 'choice'; readonly index: number }
  | { readonly kind: 'ignored' };

export type PointerSample = {
  readonly phase: PointerPhase;
  /** `PointerEvent.button`: 0 primary, 1 middle, 2 secondary. */
  readonly button: number;
  readonly target: PointerHitTarget;
};

/**
 * Resolved pointer intent.
 *
 * - `action` — logical ActionId edge (today: primary → `interact` pressed).
 * - `chooseIndex` — dialogue option pick; not an ActionId because option
 *   rows are content-dependent hit targets, not remappable controls.
 */
export type PointerIntent =
  | { readonly kind: 'action'; readonly edge: ActionEdge }
  | { readonly kind: 'chooseIndex'; readonly index: number };

/**
 * Map a pure pointer sample to a gameplay intent, or `undefined` when the
 * event is inert for the shared action layer.
 *
 * Scope (C2 WU-03): primary-button **down** only. Movement, drag-to-walk,
 * camera gestures, and editor paint strokes are intentionally out of scope —
 * they are not remappable game ActionIds today.
 */
export function resolvePointerIntent(sample: PointerSample): PointerIntent | undefined {
  if (sample.phase !== 'down') return undefined;
  if (sample.button !== 0) return undefined;

  switch (sample.target.kind) {
    case 'ignored':
      return undefined;
    case 'choice':
      return { kind: 'chooseIndex', index: sample.target.index };
    case 'actionable':
      return {
        kind: 'action',
        edge: { action: Actions.Interact, edge: 'pressed' },
      };
  }
}
