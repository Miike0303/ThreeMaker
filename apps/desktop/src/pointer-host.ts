/**
 * Desktop pointer host helpers (PLAN_DEV_2 C2 WU-03).
 *
 * Free of DOM so vitest can drive hit classification. The host still owns
 * reading attributes off the real event path and applying intents.
 */

import type { PointerHitTarget } from '@threemaker/input';

/**
 * Classify a dialogue-overlay pointer hit from an optional
 * `data-choice-index` attribute value.
 *
 * - Valid non-negative integer → choice row
 * - Missing / invalid → actionable (advance / confirm via `interact`)
 */
export function pointerTargetFromDialogueHit(
  choiceIndexAttr: string | null | undefined,
): PointerHitTarget {
  if (choiceIndexAttr === null || choiceIndexAttr === undefined || choiceIndexAttr === '') {
    return { kind: 'actionable' };
  }
  const index = Number(choiceIndexAttr);
  if (!Number.isInteger(index) || index < 0) return { kind: 'actionable' };
  return { kind: 'choice', index };
}
