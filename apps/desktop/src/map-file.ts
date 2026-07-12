/**
 * Shared working-map fs read helper (Slice 3: "Tauri fs wiring"). Reads the
 * same file the editor's `map-client.ts` writes to via `@tauri-apps/plugin-fs`
 * (`$HOME/.threemaker/maps/current.tmmap.json`, `BaseDirectory.Home` -- see
 * design's "Shared path" decision). Returns the raw JSON text, or `null` if
 * no map has been saved yet.
 *
 * This is a narrow prep helper for Slice 4's authored-load path
 * (`authored-map.ts`): parsing/validation via `@threemaker/map-format` and
 * the `isTauriAvailable()` gate (`tauri-env.ts`) are that slice's job. This
 * module is NOT wired into `main.ts` yet.
 */
import { BaseDirectory, exists, readTextFile } from '@tauri-apps/plugin-fs';

/** Directory + file for the shared working map, relative to `BaseDirectory.Home` -- kept in sync by hand with `apps/editor/src/map-client.ts`'s `MAP_FILE_RELATIVE`. */
export const MAP_DIR_RELATIVE = '.threemaker/maps';
export const MAP_FILE_RELATIVE = `${MAP_DIR_RELATIVE}/current.tmmap.json`;

/** Returns the shared map file's raw JSON text, or `null` if it hasn't been saved yet. */
export async function readMapDocumentText(): Promise<string | null> {
  const fileExists = await exists(MAP_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
  if (!fileExists) return null;
  return readTextFile(MAP_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
}
