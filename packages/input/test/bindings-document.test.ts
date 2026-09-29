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
  it('reports a fractional document version as non-integer', () => {
    expect(
      parseInputBindingsDocument({ magic: INPUT_BINDINGS_MAGIC, version: 1.5, bindings: [] }),
    ).toEqual({ ok: false, reason: 'version must be an integer' });
  });

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

  it('rejects a legacy document version', () => {
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 0,
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

  it('rejects a null binding entry without throwing', () => {
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: [null],
      }),
    ).toEqual({ ok: false, reason: 'invalid binding entry' });
  });

  it('rejects a null source in a binding without throwing', () => {
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: [{ action: Actions.Interact, source: null }],
      }),
    ).toEqual({ ok: false, reason: 'invalid binding entry' });
  });

  it('rejects a non-keyboard device source', () => {
    expect(
      parseInputBindingsDocument({
        magic: INPUT_BINDINGS_MAGIC,
        version: 1,
        bindings: [{ action: Actions.Interact, source: { device: 'gamepad', key: 'e' } }],
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

  it('persists a custom action that is absent from the default bindings', () => {
    const binding = { action: 'custom.scan', source: { device: 'keyboard' as const, key: 'q' } };
    const table = createBindingTable([binding]);

    expect(collectBindingOverrides(table, [])).toEqual([binding]);
  });

  it('does not persist unchanged aliases when their order differs', () => {
    const defaults = [
      { action: Actions.MoveUp, source: { device: 'keyboard' as const, key: 'w' } },
      { action: Actions.MoveUp, source: { device: 'keyboard' as const, key: 'ArrowUp' } },
    ];
    const reordered = createBindingTable([...defaults].reverse());
    expect(collectBindingOverrides(reordered, defaults)).toEqual([]);
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

  it('persists multiple aliases for one action while replacing all of its defaults', () => {
    const loaded = bindingTableFromPersistedText(
      serializeInputBindingsDocument([
        { action: Actions.MoveUp, source: { device: 'keyboard', key: 'i' } },
        { action: Actions.MoveUp, source: { device: 'keyboard', key: '8' } },
      ]),
    );
    const collected = collectBindingOverrides(loaded);
    const reloaded = bindingTableFromPersistedText(serializeInputBindingsDocument(collected));

    expect(reloaded.actionForKeyboardKey('i')).toBe(Actions.MoveUp);
    expect(reloaded.actionForKeyboardKey('8')).toBe(Actions.MoveUp);
    expect(reloaded.actionForKeyboardKey('w')).toBeUndefined();
    expect(reloaded.actionForKeyboardKey('ArrowUp')).toBeUndefined();
    expect(reloaded.actionForKeyboardKey('F5')).toBe(Actions.SystemSave);
  });
});

it('does not persist a case-only change to a default keyboard key', () => {
  const defaults = [
    { action: Actions.Interact, source: { device: 'keyboard' as const, key: 'e' } },
  ];
  const table = createBindingTable([
    { action: Actions.Interact, source: { device: 'keyboard', key: 'E' } },
  ]);

  expect(collectBindingOverrides(table, defaults)).toEqual([]);
});

it('loads an override using the published input bindings magic', () => {
  const text = JSON.stringify({
    magic: 'threemaker.input-bindings',
    version: 1,
    bindings: [{ action: 'interact', source: { device: 'keyboard', key: 'f' } }],
  });

  const table = bindingTableFromPersistedText(text);

  expect(table.actionForKeyboardKey('f')).toBe(Actions.Interact);
  expect(table.actionForKeyboardKey('e')).toBeUndefined();
});

it('rejects a persisted pointer source with a keyboard-shaped key', () => {
  expect(
    parseInputBindingsDocument({
      magic: INPUT_BINDINGS_MAGIC,
      version: 1,
      bindings: [{ action: Actions.Interact, source: { device: 'pointer', key: 'e' } }],
    }),
  ).toEqual({ ok: false, reason: 'invalid binding entry' });
});

it('reports the supplied unsupported input bindings version', () => {
  expect(
    parseInputBindingsDocument({ magic: INPUT_BINDINGS_MAGIC, version: 2, bindings: [] }),
  ).toEqual({ ok: false, reason: 'unknown version 2' });
});

it('reports a non-object input bindings document', () => {
  expect(parseInputBindingsDocument(null)).toEqual({
    ok: false,
    reason: 'document must be an object',
  });
});

it('reports an invalid input bindings document magic', () => {
  expect(
    parseInputBindingsDocument({ magic: 'another.bindings-format', version: 1, bindings: [] }),
  ).toEqual({ ok: false, reason: 'missing or invalid magic' });
});

it('reports a non-array input bindings collection', () => {
  expect(
    parseInputBindingsDocument({ magic: INPUT_BINDINGS_MAGIC, version: 1, bindings: {} }),
  ).toEqual({ ok: false, reason: 'bindings must be an array' });
});

it('does not persist a case-only sharp S key change', () => {
  const defaults = [
    { action: Actions.Interact, source: { device: 'keyboard' as const, key: '\u00df' } },
  ];
  const table = createBindingTable([
    { action: Actions.Interact, source: { device: 'keyboard', key: '\u1e9e' } },
  ]);

  expect(table.actionForKeyboardKey('\u00df')).toBe(Actions.Interact);
  expect(collectBindingOverrides(table, defaults)).toEqual([]);
});

it('keeps the last binding when a persisted key is assigned twice', () => {
  const text = serializeInputBindingsDocument([
    { action: Actions.Interact, source: { device: 'keyboard', key: 'q' } },
    { action: Actions.MoveUp, source: { device: 'keyboard', key: 'q' } },
  ]);

  const table = bindingTableFromPersistedText(text, []);

  expect(table.actionForKeyboardKey('q')).toBe(Actions.MoveUp);
});

it('rejects a numeric persisted action identifier', () => {
  expect(
    parseInputBindingsDocument({
      magic: INPUT_BINDINGS_MAGIC,
      version: 1,
      bindings: [{ action: 7, source: { device: 'keyboard', key: 'e' } }],
    }),
  ).toEqual({ ok: false, reason: 'invalid binding entry' });
});

it('rejects a numeric persisted keyboard key', () => {
  expect(
    parseInputBindingsDocument({
      magic: INPUT_BINDINGS_MAGIC,
      version: 1,
      bindings: [{ action: Actions.Interact, source: { device: 'keyboard', key: 7 } }],
    }),
  ).toEqual({ ok: false, reason: 'invalid binding entry' });
});
