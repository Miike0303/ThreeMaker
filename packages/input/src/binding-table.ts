import type { ActionBinding, ActionId, DeviceSource } from './types.js';

/**
 * Immutable lookup table: device source → logical action.
 * Keyboard keys are compared case-insensitively.
 */
export type BindingTable = {
  /** Resolve a raw keyboard key to its bound action, if any. */
  actionForKeyboardKey(key: string): ActionId | undefined;
  /** Snapshot of every binding (order is construction order). */
  list(): readonly ActionBinding[];
  /** New table with `binding` applied (replaces any prior map for that source). */
  withBinding(binding: ActionBinding): BindingTable;
  /** New table without the binding for `source`. */
  withoutSource(source: DeviceSource): BindingTable;
};

function sourceKey(source: DeviceSource): string {
  // WU-01: keyboard only. Later device kinds extend DeviceSource and this switch.
  return `keyboard:${source.key.toLowerCase()}`;
}

function keyboardLookupKey(key: string): string {
  return key.toLowerCase();
}

/**
 * Build a {@link BindingTable} from an ordered list of bindings.
 * Later bindings for the same source replace earlier ones.
 */
export function createBindingTable(bindings: readonly ActionBinding[]): BindingTable {
  const ordered: ActionBinding[] = [];
  const bySource = new Map<string, number>();
  const keyboard = new Map<string, ActionId>();

  for (const binding of bindings) {
    const sk = sourceKey(binding.source);
    const existingIndex = bySource.get(sk);
    if (existingIndex !== undefined) {
      ordered[existingIndex] = binding;
    } else {
      bySource.set(sk, ordered.length);
      ordered.push(binding);
    }
    if (binding.source.device === 'keyboard') {
      keyboard.set(keyboardLookupKey(binding.source.key), binding.action);
    }
  }

  const table: BindingTable = {
    actionForKeyboardKey(key) {
      return keyboard.get(keyboardLookupKey(key));
    },
    list: () => ordered,
    withBinding(binding) {
      return createBindingTable([...ordered, binding]);
    },
    withoutSource(source) {
      const sk = sourceKey(source);
      return createBindingTable(ordered.filter((b) => sourceKey(b.source) !== sk));
    },
  };

  return table;
}
