import { describe, expect, it } from 'vitest';
import { createBindingTable } from '../src/binding-table.js';
import { defaultKeyboardBindings } from '../src/defaults.js';
import { createMostRecentHeldAction, resolveKeyboardEdge } from '../src/keyboard.js';
import { Actions, HOLD_ACTIONS } from '../src/types.js';

const table = createBindingTable(defaultKeyboardBindings());

describe('resolveKeyboardEdge', () => {
  it('emits pressed on keydown for one-shot actions', () => {
    expect(resolveKeyboardEdge('e', 'down', table)).toEqual({
      action: Actions.Interact,
      edge: 'pressed',
    });
    expect(resolveKeyboardEdge('p', 'down', table)).toEqual({
      action: Actions.ViewTogglePostProcessing,
      edge: 'pressed',
    });
  });

  it('does not emit released on keyup for one-shot actions', () => {
    expect(resolveKeyboardEdge('e', 'up', table)).toBeUndefined();
    expect(resolveKeyboardEdge('p', 'up', table)).toBeUndefined();
  });

  it('emits pressed and released for hold actions (noclip)', () => {
    expect(resolveKeyboardEdge('Control', 'down', table)).toEqual({
      action: Actions.ViewNoclip,
      edge: 'pressed',
    });
    expect(resolveKeyboardEdge('Control', 'up', table)).toEqual({
      action: Actions.ViewNoclip,
      edge: 'released',
    });
  });

  it('emits pressed and released for move hold actions', () => {
    expect(resolveKeyboardEdge('w', 'down', table)).toEqual({
      action: Actions.MoveUp,
      edge: 'pressed',
    });
    expect(resolveKeyboardEdge('w', 'up', table)).toEqual({
      action: Actions.MoveUp,
      edge: 'released',
    });
  });

  it('returns undefined for unbound keys', () => {
    expect(resolveKeyboardEdge('q', 'down', table)).toBeUndefined();
    expect(resolveKeyboardEdge('q', 'up', table)).toBeUndefined();
  });

  it('uses HOLD_ACTIONS to decide which actions release on keyup', () => {
    expect(HOLD_ACTIONS.has(Actions.ViewNoclip)).toBe(true);
    expect(HOLD_ACTIONS.has(Actions.MoveUp)).toBe(true);
    expect(HOLD_ACTIONS.has(Actions.Interact)).toBe(false);
  });
});

describe('createMostRecentHeldAction', () => {
  it('reports the most recently pressed action still held', () => {
    const held = createMostRecentHeldAction((key) => table.actionForKeyboardKey(key));
    held.press('w');
    held.press('d');
    expect(held.current()).toBe(Actions.MoveRight);
    held.release('d');
    expect(held.current()).toBe(Actions.MoveUp);
  });

  it('re-pressing a held action moves it to most-recent without duplicating', () => {
    const held = createMostRecentHeldAction((key) => table.actionForKeyboardKey(key));
    held.press('a');
    held.press('w');
    held.press('a');
    expect(held.current()).toBe(Actions.MoveLeft);
    held.release('a');
    expect(held.current()).toBe(Actions.MoveUp);
  });

  it('ignores keys that do not resolve to an action', () => {
    const held = createMostRecentHeldAction((key) => table.actionForKeyboardKey(key));
    held.press('e');
    expect(held.current()).toBe(Actions.Interact);
    // When restricted to move actions only, non-move is ignored:
    const moveOnly = createMostRecentHeldAction((key) => {
      const action = table.actionForKeyboardKey(key);
      return action?.startsWith('move.') ? action : undefined;
    });
    moveOnly.press('e');
    expect(moveOnly.current()).toBeUndefined();
    moveOnly.press('w');
    moveOnly.release('e');
    expect(moveOnly.current()).toBe(Actions.MoveUp);
  });

  it('clear drops all held actions', () => {
    const held = createMostRecentHeldAction((key) => table.actionForKeyboardKey(key));
    held.press('w');
    held.press('a');
    held.clear();
    expect(held.current()).toBeUndefined();
  });
});
