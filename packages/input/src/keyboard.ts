import type { BindingTable } from './binding-table.js';
import type { ActionId } from './types.js';
import { HOLD_ACTIONS } from './types.js';

export type KeyboardPhase = 'down' | 'up';

export type ActionEdge = {
  readonly action: ActionId;
  readonly edge: 'pressed' | 'released';
};

/**
 * Resolve a raw keyboard event into a logical action edge using `table`.
 *
 * - **Hold actions** ({@link HOLD_ACTIONS}): down → pressed, up → released.
 * - **One-shot actions**: down → pressed only; up is inert.
 * - Unbound keys yield `undefined`.
 */
export function resolveKeyboardEdge(
  key: string,
  phase: KeyboardPhase,
  table: BindingTable,
  holdActions: ReadonlySet<ActionId> = HOLD_ACTIONS,
): ActionEdge | undefined {
  const action = table.actionForKeyboardKey(key);
  if (action === undefined) return undefined;

  const isHold = holdActions.has(action);
  if (phase === 'up') {
    return isHold ? { action, edge: 'released' } : undefined;
  }
  return { action, edge: 'pressed' };
}

/**
 * Tracks currently-held logical actions in press order; the most recently
 * pressed one (still held) wins when several are held at once.
 *
 * `resolve` maps a raw key to an action id (or undefined to ignore). Callers
 * that only care about movement pass a resolver that filters to move.*.
 */
export type MostRecentHeldAction = {
  press(key: string): void;
  release(key: string): void;
  current(): ActionId | undefined;
  clear(): void;
};

export function createMostRecentHeldAction(
  resolve: (key: string) => ActionId | undefined,
): MostRecentHeldAction {
  const held: ActionId[] = [];

  return {
    press(key) {
      const action = resolve(key);
      if (action === undefined) return;
      const index = held.indexOf(action);
      if (index !== -1) held.splice(index, 1);
      held.push(action);
    },
    release(key) {
      const action = resolve(key);
      if (action === undefined) return;
      const index = held.indexOf(action);
      if (index !== -1) held.splice(index, 1);
    },
    current: () => held[held.length - 1],
    clear: () => {
      held.length = 0;
    },
  };
}
