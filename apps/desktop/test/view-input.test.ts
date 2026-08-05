import {
  createBindingTable,
  defaultKeyboardBindings,
  resetDefaultBindingTableForTests,
} from '@threemaker/input';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveViewKeyAction } from '../src/view-input.js';

describe('resolveViewKeyAction', () => {
  beforeEach(() => {
    resetDefaultBindingTableForTests();
  });

  it('maps view keys on keydown', () => {
    expect(resolveViewKeyAction('p', 'down')).toEqual({ kind: 'toggle-post-processing' });
    expect(resolveViewKeyAction('C', 'down')).toEqual({ kind: 'cycle-camera-mode' });
    expect(resolveViewKeyAction('[', 'down')).toEqual({ kind: 'tilt', delta: -1 });
    expect(resolveViewKeyAction(']', 'down')).toEqual({ kind: 'tilt', delta: 1 });
    expect(resolveViewKeyAction('-', 'down')).toEqual({ kind: 'zoom', delta: 1 });
    expect(resolveViewKeyAction('_', 'down')).toEqual({ kind: 'zoom', delta: 1 });
    expect(resolveViewKeyAction('=', 'down')).toEqual({ kind: 'zoom', delta: -1 });
    expect(resolveViewKeyAction('+', 'down')).toEqual({ kind: 'zoom', delta: -1 });
    expect(resolveViewKeyAction('Control', 'down')).toEqual({ kind: 'noclip-on' });
  });

  it('maps F5/F9 to save/load one-shots', () => {
    const table = createBindingTable(defaultKeyboardBindings());
    expect(resolveViewKeyAction('F5', 'down', table)).toEqual({ kind: 'save' });
    expect(resolveViewKeyAction('F9', 'down', table)).toEqual({ kind: 'load' });
    expect(resolveViewKeyAction('F5', 'up', table)).toBeUndefined();
    expect(resolveViewKeyAction('F9', 'up', table)).toBeUndefined();
  });

  it('only maps Control on keyup (noclip release)', () => {
    expect(resolveViewKeyAction('Control', 'up')).toEqual({ kind: 'noclip-off' });
    expect(resolveViewKeyAction('p', 'up')).toBeUndefined();
    expect(resolveViewKeyAction('c', 'up')).toBeUndefined();
  });

  it('returns undefined for unmapped keys', () => {
    expect(resolveViewKeyAction('g', 'down')).toBeUndefined();
    expect(resolveViewKeyAction('e', 'down')).toBeUndefined();
    expect(resolveViewKeyAction('ArrowUp', 'down')).toBeUndefined();
  });
});
