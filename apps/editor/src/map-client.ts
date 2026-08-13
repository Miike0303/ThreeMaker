/**
 * Map persistence client (Slice 3: "Tauri fs wiring"). Two backends behind
 * one interface, same pattern as `catalog-client.ts`:
 *  - the real Tauri host, using `@tauri-apps/plugin-fs` against
 *    `BaseDirectory.Home` -- the shared working files both the editor and
 *    `apps/desktop` read/write (see design's "Shared path" decision);
 *  - a dev-only HTTP fallback (`/api/dev-map/save|load|list|rename|delete`,
 *    see `dev-server/map-api.ts` + `vite.config.ts`'s `devMapApiPlugin`), used
 *    when `window.__TAURI_INTERNALS__` is absent (plain `vite dev`, no Tauri
 *    host attached).
 *
 * Maps are named files under `.threemaker/maps/{name}.tmmap.json`. The
 * historical `current.tmmap.json` is adopted as the map named `current`.
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { MapDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { isTauriAvailable } from './catalog-client.js';
import {
  assertMapName,
  existingMapDocumentFileName,
  InvalidMapNameError,
  LEGACY_MAP_NAME,
  listMapNamesFromEntries,
  MAP_DIR_RELATIVE,
  mapDocumentFileName,
  mapFileRelativePath,
  planDeleteMapFiles,
  planRenameMapFiles,
} from './map-identity.js';

export {
  LEGACY_MAP_NAME,
  MAP_DIR_RELATIVE,
  MAP_FILE_RELATIVE,
  MAP_FILE_SUFFIX,
  mapDocumentFileName,
  mapFileRelativePath,
} from './map-identity.js';

const DEV_MAP_API_BASE = '/api/dev-map';
const FS_HOME = { baseDir: BaseDirectory.Home } as const;

export class MapClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapClientError';
  }
}

function wrapMapName(run: () => string): string {
  try {
    return run();
  } catch (error) {
    if (error instanceof InvalidMapNameError) {
      throw new MapClientError(error.message);
    }
    throw error;
  }
}

function mapNameQuery(name: string): string {
  return name === LEGACY_MAP_NAME ? '' : `?name=${encodeURIComponent(name)}`;
}

async function readMapDirectoryNames(): Promise<string[]> {
  const dirExists = await exists(MAP_DIR_RELATIVE, FS_HOME);
  if (!dirExists) return [];
  const entries = await readDir(MAP_DIR_RELATIVE, FS_HOME);
  return entries.map((entry) => entry.name);
}

/** Saves `doc` as `{mapName}.tmmap.json` (default: legacy `current`). */
export async function saveMapDocument(
  doc: MapDocument,
  mapName: string = LEGACY_MAP_NAME,
): Promise<void> {
  const name = wrapMapName(() => assertMapName(mapName));
  const relative = mapFileRelativePath(name);
  if (isTauriAvailable()) {
    const entries = await readMapDirectoryNames();
    const existing = existingMapDocumentFileName(name, entries);
    if (existing !== undefined && existing !== mapDocumentFileName(name)) {
      throw new MapClientError(`Map ${JSON.stringify(name)} already exists`);
    }
    await mkdir(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
    await writeTextFile(relative, serializeMapDocument(doc), FS_HOME);
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/save${mapNameQuery(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: serializeMapDocument(doc),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to save the map: HTTP ${response.status}`);
  }
}

/** Loads `{mapName}.tmmap.json`, or `null` if it has not been saved yet. */
export async function loadMapDocument(
  mapName: string = LEGACY_MAP_NAME,
): Promise<MapDocument | null> {
  const name = wrapMapName(() => assertMapName(mapName));
  const relative = mapFileRelativePath(name);
  if (isTauriAvailable()) {
    const fileExists = await exists(relative, FS_HOME);
    if (!fileExists) return null;
    const text = await readTextFile(relative, FS_HOME);
    return parseMapDocument(JSON.parse(text));
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/load${mapNameQuery(name)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapClientError(`Failed to load the map: HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseMapDocument(json);
}

/** Sorted map stems present in the maps directory (includes legacy `current`). */
export async function listSavedMaps(): Promise<readonly string[]> {
  if (isTauriAvailable()) {
    return listMapNamesFromEntries(await readMapDirectoryNames());
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/list`);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new MapClientError(`Failed to list maps: HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  if (!Array.isArray(json) || json.some((entry) => typeof entry !== 'string')) {
    throw new MapClientError('Failed to list maps: unexpected response');
  }
  return listMapNamesFromEntries(
    json.map((entry) => (entry.endsWith('.tmmap.json') ? entry : `${entry}.tmmap.json`)),
  );
}

/** Renames a saved map and moves its `.ink` sidecars with it. */
export async function renameSavedMap(fromRaw: string, toRaw: string): Promise<void> {
  const from = wrapMapName(() => assertMapName(fromRaw));
  const to = wrapMapName(() => assertMapName(toRaw));
  if (isTauriAvailable()) {
    try {
      const moves = planRenameMapFiles(from, to, await readMapDirectoryNames());
      for (const move of moves) {
        await rename(move.from, move.to, {
          oldPathBaseDir: BaseDirectory.Home,
          newPathBaseDir: BaseDirectory.Home,
        });
      }
    } catch (error) {
      if (error instanceof InvalidMapNameError) {
        throw new MapClientError(error.message);
      }
      throw new MapClientError(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to rename the map: HTTP ${response.status}`);
  }
}

/** Deletes a saved map document and its `.ink` sidecars. */
export async function deleteSavedMap(mapName: string): Promise<void> {
  const name = wrapMapName(() => assertMapName(mapName));
  if (isTauriAvailable()) {
    const paths = planDeleteMapFiles(name, await readMapDirectoryNames());
    for (const path of paths) {
      await remove(path, FS_HOME);
    }
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to delete the map: HTTP ${response.status}`);
  }
}
