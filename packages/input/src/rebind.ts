import type { BindingTable } from './binding-table.js';
import type { ActionId } from './types.js';

/**
 * Drop every keyboard source currently bound to `action`.
 * Composed from {@link BindingTable.withoutSource} only.
 */
export function clearKeyboardSourcesForAction(table: BindingTable, action: ActionId): BindingTable {
  let next = table;
  for (const binding of table.list()) {
    if (binding.action === action && binding.source.device === 'keyboard') {
      next = next.withoutSource(binding.source);
    }
  }
  return next;
}

/**
 * Reassign `action` to a single keyboard key: clears prior keyboard sources
 * for that action, steals `key` if another action held it, then binds.
 * Built only from {@link BindingTable.withoutSource} / {@link BindingTable.withBinding}.
 */
export function rebindKeyboard(table: BindingTable, action: ActionId, key: string): BindingTable {
  let next = clearKeyboardSourcesForAction(table, action);
  next = next.withoutSource({ device: 'keyboard', key });
  return next.withBinding({
    action,
    source: { device: 'keyboard', key },
  });
}
