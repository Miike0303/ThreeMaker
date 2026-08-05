import { describe, expect, it } from 'vitest';
import { createBindingTable } from '../src/binding-table.js';
import { defaultKeyboardBindings } from '../src/defaults.js';
import { rebindKeyboard } from '../src/rebind.js';
import { Actions } from '../src/types.js';

describe('rebindKeyboard', () => {
  it('replaces every keyboard source for an action with the new key', () => {
    const base = createBindingTable(defaultKeyboardBindings());
    const next = rebindKeyboard(base, Actions.Interact, 'f');
    expect(next.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(next.actionForKeyboardKey('e')).toBeUndefined();
  });

  it('steals a key previously bound to a different action', () => {
    const base = createBindingTable(defaultKeyboardBindings());
    const next = rebindKeyboard(base, Actions.Interact, 'w');
    expect(next.actionForKeyboardKey('w')).toBe(Actions.Interact);
    // move.up still has ArrowUp
    expect(next.actionForKeyboardKey('ArrowUp')).toBe(Actions.MoveUp);
  });

  it('collapses multi-key defaults (move.up) to a single new key', () => {
    const base = createBindingTable(defaultKeyboardBindings());
    const next = rebindKeyboard(base, Actions.MoveUp, 'i');
    expect(next.actionForKeyboardKey('i')).toBe(Actions.MoveUp);
    expect(next.actionForKeyboardKey('w')).toBeUndefined();
    expect(next.actionForKeyboardKey('ArrowUp')).toBeUndefined();
  });

  it('is built from withoutSource + withBinding (immutable table)', () => {
    const base = createBindingTable(defaultKeyboardBindings());
    const next = rebindKeyboard(base, Actions.Interact, 'q');
    expect(base.actionForKeyboardKey('e')).toBe(Actions.Interact);
    expect(next).not.toBe(base);
  });
});
