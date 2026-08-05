/**
 * Pure gameplay key routing for narrative interaction over `@threemaker/input`
 * for the remappable interact action; dialogue keys stay host/UI via
 * {@link resolveDialogueKeyAction}.
 *
 * Binding table is injectable (WU-04); defaults keep existing call sites working.
 */

import type { ActionId, BindingTable } from '@threemaker/input';
import { Actions, defaultBindingTable } from '@threemaker/input';
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
 * Resolve a logical {@link ActionId} (keyboard or gamepad) into a gameplay
 * intent for the current interpreter state.
 *
 * - `idle` → `interact` only
 * - `running` → nothing
 * - dialogue wait → `interact` advances / confirms; `move.*` navigates choices
 */
export function resolveGameplayAction(
  actionId: ActionId,
  interpreterState: GameplayInterpreterState,
): GameplayKeyAction | undefined {
  if (interpreterState === 'idle') {
    return actionId === Actions.Interact ? { kind: 'try-interact' } : undefined;
  }
  if (interpreterState === 'running') {
    return undefined;
  }
  if (actionId === Actions.Interact) {
    return interpreterState === 'waiting-for-choice'
      ? { kind: 'confirmHighlighted' }
      : { kind: 'advance' };
  }
  if (interpreterState === 'waiting-for-choice') {
    if (actionId === Actions.MoveUp || actionId === Actions.MoveLeft) {
      return { kind: 'navigate', delta: -1 };
    }
    if (actionId === Actions.MoveDown || actionId === Actions.MoveRight) {
      return { kind: 'navigate', delta: 1 };
    }
  }
  return undefined;
}

/**
 * Resolve a raw `KeyboardEvent.key` into a gameplay intent for the current
 * interpreter state, or `undefined` when the key is inert in that state.
 *
 * - `idle` → interact action only (face NPC / interact trigger)
 * - `running` → nothing (script owns input; host moves etc.)
 * - dialogue wait states → same mapping as {@link resolveDialogueKeyAction}
 */
export function resolveGameplayKeyAction(
  key: string,
  interpreterState: GameplayInterpreterState,
  table: BindingTable = defaultBindingTable(),
): GameplayKeyAction | undefined {
  if (interpreterState === 'idle') {
    const actionId = table.actionForKeyboardKey(key);
    return actionId !== undefined ? resolveGameplayAction(actionId, interpreterState) : undefined;
  }
  if (interpreterState === 'running') {
    return undefined;
  }
  const hasChoices = interpreterState === 'waiting-for-choice';
  return resolveDialogueKeyAction(key, hasChoices);
}
