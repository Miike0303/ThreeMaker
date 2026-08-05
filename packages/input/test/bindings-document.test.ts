import { describe, expect, it } from 'vitest';
import { createBindingTable } from '../src/binding-table.js';
import {
  applyBindingOverrides,
  bindingTableFromPersistedText,
  CURRENT_INPUT_BINDINGS_VERSION,
  collectBindingOverrides,
  INPUT_BINDINGS_MAGIC,
  parseInputBindingsDocument,
  serializeInputBindingsDocument,
} from '../src/bindings-document.js';
import { defaultKeyboardBindings } from '../src/defaults.js';
import { rebindKeyboard } from '../src/rebind.js';
import { Actions } from '../src/types.js';

describe('serializeInputBindingsDocument / parseInputBindingsDocument', () => {
  it('round-trips a valid v1 document', () => {
    const bindings = [
      { action: Actions.Interact, source: { device: 'keyboard' as const, key: 'f' } },
    ];
    const text = serializeInputBindingsDocument(bindings);
    const parsed = parseInputBindingsDocument(JSON.parse(text));
    expect(parsed).toEqual({ ok: true, version: 1, bindings });
    expect(JSON.parse(text)).toMatchObject({
      magic: INPUT_BINDINGS_MAGIC,
      version: CURRENT_INPUT_BINDINGS_VERSION,
    });
  });

  it('rejects missing magic, non-objects, and unknown versions without throwing', () => {
    expect(parseInputBindingsDocument(null).ok).toBe(false);
    expect(parseInputBindingsDocument({ version: 1, bindings: [] }).ok).toBe(false);
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 99,
        bindings: [],
      }).ok,
    ).toBe(false);
    expect(
      parseInputBindingsDocument({
        magic: 'other',
        version: 1,
        bindings: [],
      }).ok,
    ).toBe(false);
  });

  it('rejects malformed bindings entries', () => {
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: [{ action: Actions.Interact, source: { device: 'keyboard', key: '' } }],
      }).ok,
    ).toBe(false);
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: [{ action: '', source: { device: 'keyboard', key: 'f' } }],
      }).ok,
    ).toBe(false);
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: 'nope',
      }).ok,
    ).toBe(false);
  });
});

describe('applyBindingOverrides / collectBindingOverrides', () => {
  it('merges keyboard overrides onto defaults via rebind semantics', () => {
    const defaults = createBindingTable(defaultKeyboardBindings());
    const merged = applyBindingOverrides(defaults, [
      { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
    ]);
    expect(merged.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(merged.actionForKeyboardKey('e')).toBeUndefined();
    // Unrelated defaults stay
    expect(merged.actionForKeyboardKey('w')).toBe(Actions.MoveUp);
  });

  it('collects only actions whose keyboard sources differ from defaults', () => {
    const defaults = createBindingTable(defaultKeyboardBindings());
    expect(collectBindingOverrides(defaults)).toEqual([]);

    const remapped = rebindKeyboard(defaults, Actions.Interact, 'f');
    expect(collectBindingOverrides(remapped)).toEqual([
      { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
    ]);
  });

  it('load path: invalid document falls back to pure defaults (host uses this)', () => {
    const result = parseInputBindingsDocument({ magic: 'x', version: 1, bindings: [] });
    expect(result.ok).toBe(false);
    const table = createBindingTable(defaultKeyboardBindings());
    expect(table.actionForKeyboardKey('e')).toBe(Actions.Interact);
  });

  it('bindingTableFromPersistedText merges good JSON and falls back on bad/missing', () => {
    const good = serializeInputBindingsDocument([
      { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
    ]);
    expect(bindingTableFromPersistedText(good).actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(bindingTableFromPersistedText(null).actionForKeyboardKey('e')).toBe(Actions.Interact);
    expect(bindingTableFromPersistedText('{not json').actionForKeyboardKey('e')).toBe(
      Actions.Interact,
    );
    expect(
      bindingTableFromPersistedText(
        JSON.stringify({ magic: INPUT_BINDINGS_MAGIC, version: 2, bindings: [] }),
      ).actionForKeyboardKey('e'),
    ).toBe(Actions.Interact);
  });

  it('loads a pre-save-action bindings v1 override and still gets F5/F9 from defaults', () => {
    // Document as written when only interact was remapped (before system.save/load existed).
    const legacyV1 = serializeInputBindingsDocument([
      { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
    ]);
    const table = bindingTableFromPersistedText(legacyV1);
    expect(table.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(table.actionForKeyboardKey('F5')).toBe(Actions.SystemSave);
    expect(table.actionForKeyboardKey('F9')).toBe(Actions.SystemLoad);
  });
});
