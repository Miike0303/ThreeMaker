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
/** The batch `convert-rpgm-game` CLI's manifest (rpgm-whole-game-import change): an ordered list of converted maps plus an optional player character-sheet reference. Read by `main.ts`'s multi-map navigation -- see `game-manifest.ts`. */
export const MANIFEST_FILE_RELATIVE = `${MAP_DIR_RELATIVE}/manifest.json`;

/** Reads any file relative to `BaseDirectory.Home`, or `null` if it doesn't exist yet. Shared by the single "current" map read and the manifest/per-entry-map reads below -- every one of these lives somewhere under `.threemaker/maps`. */
async function readHomeFileText(relativePath: string): Promise<string | null> {
  const fileExists = await exists(relativePath, { baseDir: BaseDirectory.Home });
  if (!fileExists) return null;
  return readTextFile(relativePath, { baseDir: BaseDirectory.Home });
}

/**
 * Returns a map document's raw JSON text, or `null` if it hasn't been saved
 * yet. Defaults to the single shared working map (`MAP_FILE_RELATIVE`,
 * unchanged single-file behavior); pass a manifest entry's own relative path
 * (e.g. `` `${MAP_DIR_RELATIVE}/${entry.file}` ``) to load one specific
 * converted map instead (multi-map navigation, `main.ts`).
 */
export async function readMapDocumentText(
  relativePath: string = MAP_FILE_RELATIVE,
): Promise<string | null> {
  return readHomeFileText(relativePath);
}

/** Returns the game manifest's raw JSON text, or `null` if no batch-converted game has been pointed at `.threemaker/maps` yet (single-file mode stays the fallback -- see `main.ts`). */
export async function readManifestText(): Promise<string | null> {
  return readHomeFileText(MANIFEST_FILE_RELATIVE);
}
