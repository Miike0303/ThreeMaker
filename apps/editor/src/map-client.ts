/**
 * Map persistence client (Slice 4: "map format save"). Dev-only HTTP
 * fallback (`/api/dev-map/save|load`, see `dev-server/map-api.ts` +
 * `vite.config.ts`'s `devMapApiPlugin`) is the only wired-and-verified path
 * this slice -- the editor's headed-Edge verification runs under plain
 * `vite dev`, not a real Tauri host (same reasoning as `catalog-client.ts`'s
 * dev fallback).
 *
 * ponytail / KNOWN GAP: the real Tauri host path (`@tauri-apps/plugin-fs`)
 * is intentionally NOT wired this slice -- the dependency isn't added, no
 * filesystem capability is declared in `tauri.conf.json`, and it cannot be
 * verified without a real Tauri run. `saveMapDocument`/`loadMapDocument`
 * throw a clear "not implemented" error under `isTauriAvailable()` rather
 * than silently no-op or ship unverified capability config. Flagged as
 * remaining work for a future slice/pass.
 */

import type { MapDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { isTauriAvailable } from './catalog-client.js';

const DEV_MAP_API_BASE = '/api/dev-map';

export class MapClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapClientError';
  }
}

/** Saves `doc` as the editor's single working map file. Throws `MapClientError` on failure. */
export async function saveMapDocument(doc: MapDocument): Promise<void> {
  if (isTauriAvailable()) {
    throw new MapClientError(
      'Saving from inside the real Tauri host is not implemented yet -- this slice only wires the dev-fallback HTTP path. See map-client.ts.',
    );
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
    throw new MapClientError(
      'Loading from inside the real Tauri host is not implemented yet -- this slice only wires the dev-fallback HTTP path. See map-client.ts.',
    );
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/load`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapClientError(`Failed to load the map: HTTP ${response.status}`);
  }
  const json = await response.json();
  return parseMapDocument(json);
}
