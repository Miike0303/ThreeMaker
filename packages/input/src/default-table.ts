import type { BindingTable } from './binding-table.js';
import { createBindingTable } from './binding-table.js';
import { defaultKeyboardBindings } from './defaults.js';

/**
 * Process-wide default binding table for optional seam parameters.
 * Hosts that load remaps should inject their own table and not rely on this.
 */
let cached: BindingTable | undefined;

export function defaultBindingTable(): BindingTable {
  if (cached === undefined) {
    cached = createBindingTable(defaultKeyboardBindings());
  }
  return cached;
}

/** Test helper: drop the cached default so isolation tests can rebuild it. */
export function resetDefaultBindingTableForTests(): void {
  cached = undefined;
}
