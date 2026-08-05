/**
 * Host I/O for versioned input bindings (PLAN_DEV_2 C2 WU-04).
 *
 * Path mirrors maps: `$HOME/.threemaker/input-bindings.json` via
 * `BaseDirectory.Home` when Tauri is available. Outside Tauri (plain Vite),
 * falls back to `localStorage` so remaps still survive a browser reload
 * during dev. Parse/merge stay pure in `@threemaker/input`.
 */

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { BindingTable } from '@threemaker/input';
import {
  bindingTableFromPersistedText,
  collectBindingOverrides,
  createBindingTable,
  defaultKeyboardBindings,
  serializeInputBindingsDocument,
} from '@threemaker/input';
import { isTauriAvailable } from './tauri-env.js';

/** Directory under Home (same parent as maps). */
export const INPUT_BINDINGS_DIR_RELATIVE = '.threemaker';
/** Full relative path under `BaseDirectory.Home`. */
export const INPUT_BINDINGS_FILE_RELATIVE = `${INPUT_BINDINGS_DIR_RELATIVE}/input-bindings.json`;
/** localStorage key used when Tauri fs is unavailable. */
export const INPUT_BINDINGS_STORAGE_KEY = 'threemaker:input-bindings';

export type TextStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read raw JSON text, or null when nothing is stored yet / I/O fails. */
export async function readInputBindingsText(
  storage: TextStore | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<string | null> {
  if (isTauriAvailable()) {
    try {
      const fileExists = await exists(INPUT_BINDINGS_FILE_RELATIVE, {
        baseDir: BaseDirectory.Home,
      });
      if (!fileExists) return null;
      return await readTextFile(INPUT_BINDINGS_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
    } catch {
      return null;
    }
  }
  if (!storage) return null;
  try {
    return storage.getItem(INPUT_BINDINGS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist raw JSON text (best-effort; failures are swallowed). */
export async function writeInputBindingsText(
  text: string,
  storage: TextStore | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<void> {
  if (isTauriAvailable()) {
    try {
      await mkdir(INPUT_BINDINGS_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
      await writeTextFile(INPUT_BINDINGS_FILE_RELATIVE, text, { baseDir: BaseDirectory.Home });
    } catch {
      // Remap persistence must never block play.
    }
    return;
  }
  if (!storage) return;
  try {
    storage.setItem(INPUT_BINDINGS_STORAGE_KEY, text);
  } catch {
    // Best-effort only.
  }
}

/** Boot: load + validate + merge over defaults (never throws). */
export async function loadInputBindingTable(storage?: TextStore | null): Promise<BindingTable> {
  const text = await readInputBindingsText(storage);
  return bindingTableFromPersistedText(text);
}

/**
 * Persist only overrides relative to defaults (small file; load re-merges).
 * Empty overrides still writes a valid empty v1 document so reset is explicit.
 */
export async function saveInputBindingTable(
  table: BindingTable,
  storage?: TextStore | null,
): Promise<void> {
  const overrides = collectBindingOverrides(table);
  const text = serializeInputBindingsDocument(overrides);
  await writeInputBindingsText(text, storage);
}

/** Fresh defaults table (e.g. reset command). */
export function createDefaultInputBindingTable(): BindingTable {
  return createBindingTable(defaultKeyboardBindings());
}
