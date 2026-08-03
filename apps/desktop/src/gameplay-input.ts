/**
 * Pure gameplay key routing for narrative interaction (PLAN_DEV_2 C2 prep:
 * extract what desktop already does before a shared `packages/input` layer).
 *
 * Idle: only `E` starts an NPC/trigger interact. Dialogue states re-use
 * {@link resolveDialogueKeyAction}. Free of DOM so vitest can drive it; the
 * host (`main.ts`) still owns running scripts and applying dialogue effects.
 */

import type { DialogueKeyAction } from './dialogue-ui.js';
import { resolveDialogueKeyAction } from './dialogue-ui.js';

/** Interpreter states the desktop key router cares about (mirrors core). */
export type GameplayInterpreterState =
  | 'idle'
  | 'running'
  | 'waiting-for-dialogue'
  | 'waiting-for-choice';

export type GameplayKeyAction = { readonly kind: 'try-interact' } | DialogueKeyAction;

/**
 * Resolve a raw `KeyboardEvent.key` into a gameplay intent for the current
 * interpreter state, or `undefined` when the key is inert in that state.
 *
 * - `idle` → `E` only (face NPC / interact trigger)
 * - `running` → nothing (script owns input; host moves etc.)
 * - dialogue wait states → same mapping as {@link resolveDialogueKeyAction}
 */
export function resolveGameplayKeyAction(
  key: string,
  interpreterState: GameplayInterpreterState,
): GameplayKeyAction | undefined {
  if (interpreterState === 'idle') {
    return key.toLowerCase() === 'e' ? { kind: 'try-interact' } : undefined;
  }
  if (interpreterState === 'running') {
    return undefined;
  }
  const hasChoices = interpreterState === 'waiting-for-choice';
  return resolveDialogueKeyAction(key, hasChoices);
}
