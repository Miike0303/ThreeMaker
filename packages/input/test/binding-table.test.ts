import { describe, expect, it } from 'vitest';
import { createBindingTable } from '../src/binding-table.js';
import type { ActionBinding } from '../src/types.js';

const sample: readonly ActionBinding[] = [
  { action: 'move.up', source: { device: 'keyboard', key: 'w' } },
  { action: 'move.up', source: { device: 'keyboard', key: 'ArrowUp' } },
  { action: 'interact', source: { device: 'keyboard', key: 'e' } },
];

describe('createBindingTable', () => {
  it('resolves keyboard keys to actions case-insensitively', () => {
    const table = createBindingTable(sample);
    expect(table.actionForKeyboardKey('w')).toBe('move.up');
    expect(table.actionForKeyboardKey('W')).toBe('move.up');
    expect(table.actionForKeyboardKey('ArrowUp')).toBe('move.up');
    expect(table.actionForKeyboardKey('arrowup')).toBe('move.up');
    expect(table.actionForKeyboardKey('E')).toBe('interact');
  });

  it('returns undefined for unbound keys', () => {
    const table = createBindingTable(sample);
    expect(table.actionForKeyboardKey('q')).toBeUndefined();
    expect(table.actionForKeyboardKey(' ')).toBeUndefined();
  });

  it('lists the bindings it was built from', () => {
    const table = createBindingTable(sample);
    expect(table.list()).toEqual(sample);
  });

  it('withBinding replaces any existing keyboard key mapping (last writer wins)', () => {
    const table = createBindingTable(sample).withBinding({
      action: 'interact',
      source: { device: 'keyboard', key: 'w' },
    });
    expect(table.actionForKeyboardKey('w')).toBe('interact');
    expect(table.actionForKeyboardKey('e')).toBe('interact');
    // Prior ArrowUp → move.up still present
    expect(table.actionForKeyboardKey('ArrowUp')).toBe('move.up');
  });

  it('withoutSource drops a keyboard binding by normalized key', () => {
    const table = createBindingTable(sample).withoutSource({
      device: 'keyboard',
      key: 'W',
    });
    expect(table.actionForKeyboardKey('w')).toBeUndefined();
    expect(table.actionForKeyboardKey('e')).toBe('interact');
  });
});
