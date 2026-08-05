import { describe, expect, it } from 'vitest';
import { createBindingTable } from '../src/binding-table.js';
import { defaultKeyboardBindings } from '../src/defaults.js';
import { Actions } from '../src/types.js';

describe('defaultKeyboardBindings', () => {
  const table = createBindingTable(defaultKeyboardBindings());

  it('maps WASD and arrows to move.* actions', () => {
    expect(table.actionForKeyboardKey('w')).toBe(Actions.MoveUp);
    expect(table.actionForKeyboardKey('ArrowUp')).toBe(Actions.MoveUp);
    expect(table.actionForKeyboardKey('s')).toBe(Actions.MoveDown);
    expect(table.actionForKeyboardKey('ArrowDown')).toBe(Actions.MoveDown);
    expect(table.actionForKeyboardKey('a')).toBe(Actions.MoveLeft);
    expect(table.actionForKeyboardKey('ArrowLeft')).toBe(Actions.MoveLeft);
    expect(table.actionForKeyboardKey('d')).toBe(Actions.MoveRight);
    expect(table.actionForKeyboardKey('ArrowRight')).toBe(Actions.MoveRight);
  });

  it('maps E to interact', () => {
    expect(table.actionForKeyboardKey('e')).toBe(Actions.Interact);
  });

  it('maps view/debug keys matching the desktop seams', () => {
    expect(table.actionForKeyboardKey('p')).toBe(Actions.ViewTogglePostProcessing);
    expect(table.actionForKeyboardKey('c')).toBe(Actions.ViewCycleCamera);
    expect(table.actionForKeyboardKey('[')).toBe(Actions.ViewTiltDown);
    expect(table.actionForKeyboardKey(']')).toBe(Actions.ViewTiltUp);
    expect(table.actionForKeyboardKey('-')).toBe(Actions.ViewZoomOut);
    expect(table.actionForKeyboardKey('_')).toBe(Actions.ViewZoomOut);
    expect(table.actionForKeyboardKey('=')).toBe(Actions.ViewZoomIn);
    expect(table.actionForKeyboardKey('+')).toBe(Actions.ViewZoomIn);
    expect(table.actionForKeyboardKey('Control')).toBe(Actions.ViewNoclip);
  });

  it('maps F5/F9 to system save/load (C3 quick-save defaults)', () => {
    expect(table.actionForKeyboardKey('F5')).toBe(Actions.SystemSave);
    expect(table.actionForKeyboardKey('f5')).toBe(Actions.SystemSave);
    expect(table.actionForKeyboardKey('F9')).toBe(Actions.SystemLoad);
  });

  it('does not bind dialogue-only keys (Enter/Space/digits stay host/UI)', () => {
    expect(table.actionForKeyboardKey('Enter')).toBeUndefined();
    expect(table.actionForKeyboardKey(' ')).toBeUndefined();
    expect(table.actionForKeyboardKey('1')).toBeUndefined();
  });
});
