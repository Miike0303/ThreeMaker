/**
 * Map persistence client (Slice 3: "Tauri fs wiring"). Two backends behind
 * one interface, same pattern as `catalog-client.ts`:
 *  - the real Tauri host, using `@tauri-apps/plugin-fs` against
 *    `BaseDirectory.Home` -- the shared working file both the editor and
 *    `apps/desktop` read/write (see design's "Shared path" decision);
 *  - a dev-only HTTP fallback (`/api/dev-map/save|load`, see
 *    `dev-server/map-api.ts` + `vite.config.ts`'s `devMapApiPlugin`), used
 *    when `window.__TAURI_INTERNALS__` is absent (plain `vite dev`, no Tauri
 *    host attached).
 */

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { MapDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { isTauriAvailable } from './catalog-client.js';

const DEV_MAP_API_BASE = '/api/dev-map';

/** Directory + file for the shared working map, relative to `BaseDirectory.Home` -- kept in sync with `apps/desktop`'s reader and `vite.config.ts`'s dev-fallback path. */
export const MAP_DIR_RELATIVE = '.threemaker/maps';
export const MAP_FILE_RELATIVE = `${MAP_DIR_RELATIVE}/current.tmmap.json`;

export class MapClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapClientError';
  }
}

/** Saves `doc` as the editor's single working map file. Throws `MapClientError` on failure. */
export async function saveMapDocument(doc: MapDocument): Promise<void> {
  if (isTauriAvailable()) {
    await mkdir(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
    await writeTextFile(MAP_FILE_RELATIVE, serializeMapDocument(doc), {
      baseDir: BaseDirectory.Home,
    });
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: serializeMapDocument(doc),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to save the map: HTTP ${response.status}`);
  }
}

/** Loads the editor's single working map file, or `null` if none has been saved yet. Throws `MapClientError` on any other failure (including a document that fails map-format validation). */
export async function loadMapDocument(): Promise<MapDocument | null> {
  if (isTauriAvailable()) {
    const fileExists = await exists(MAP_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
    if (!fileExists) return null;
    const text = await readTextFile(MAP_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
    return parseMapDocument(JSON.parse(text));
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/load`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapClientError(`Failed to load the map: HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseMapDocument(json);
}
