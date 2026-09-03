/**
 * Ink sidecar authoring seams for the editor (L4 WU-02).
 *
 * Path convention matches desktop `authored-map.ts` design D7:
 * `.threemaker/maps/{mapName}.tmmap.json` → `.threemaker/maps/{mapName}.{storyId}.ink`
 *
 * Persistence reuses the same Tauri / dev-HTTP backends as `map-client.ts`.
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { EventCommand } from '@threemaker/core';
import {
  inkSidecarRelativePath as buildInkSidecarRelativePath,
  isSafeStoryId,
} from '@threemaker/map-format';
import {
  buildInkGraphModel,
  compileInk,
  InkCompileError,
  type InkIssue,
  listInkKnots,
  parseInkNodeLayouts,
  setInkNodePosition,
} from '@threemaker/narrative';
import { isTauriAvailable } from './catalog-client.js';
import { MAP_DIR_RELATIVE, MapClientError, mapFileRelativePath } from './map-client.js';
import {
  assertMapName,
  InvalidMapNameError,
  LEGACY_MAP_NAME,
  listInkStoryIdsFromEntries,
} from './map-identity.js';

const DEV_MAP_API_BASE = '/api/dev-map';

export { isSafeStoryId };

/**
 * Home-relative (or maps-root-relative) path for one story's `.ink` sidecar.
 * Throws when `storyId` is not path-safe.
 */
export function inkSidecarRelativePath(mapRelativePath: string, storyId: string): string {
  try {
    return buildInkSidecarRelativePath(mapRelativePath, storyId);
  } catch (error) {
    throw new MapClientError(error instanceof Error ? error.message : String(error));
  }
}

export type InkStoryOpenStatus = 'empty' | 'ready' | 'unknown-story' | 'unsafe-story-id';

export interface InkStoryOpenModel {
  readonly storyOptions: readonly string[];
  readonly status: InkStoryOpenStatus;
}

/** Datalist + soft-warning model for typing a story id (same shape as the Events knot picker). */
export function buildInkStoryOpenModel(
  knownStoryIds: readonly string[],
  typedId: string,
): InkStoryOpenModel {
  const trimmed = typedId.trim();
  let status: InkStoryOpenStatus;
  if (trimmed === '') status = 'empty';
  else if (!isSafeStoryId(trimmed)) status = 'unsafe-story-id';
  else if (!knownStoryIds.includes(trimmed)) status = 'unknown-story';
  else status = 'ready';
  return { storyOptions: [...knownStoryIds], status };
}

function usableMapName(mapName: string): string {
  try {
    return assertMapName(mapName);
  } catch (error) {
    if (error instanceof InvalidMapNameError) {
      throw new MapClientError(error.message);
    }
    throw error;
  }
}

/** Story ids whose `.ink` sidecars already exist next to the named map. */
export async function listInkSidecars(
  mapName: string = LEGACY_MAP_NAME,
): Promise<readonly string[]> {
  const name = usableMapName(mapName);
  if (isTauriAvailable()) {
    const dirExists = await exists(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home });
    if (!dirExists) return [];
    const entries = await readDir(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home });
    return listInkStoryIdsFromEntries(
      entries.map((entry) => entry.name),
      name,
    );
  }
  const nameQuery = name === LEGACY_MAP_NAME ? '' : `?name=${encodeURIComponent(name)}`;
  const response = await fetch(`${DEV_MAP_API_BASE}/ink-list${nameQuery}`);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new MapClientError(`Failed to list ink sidecars: HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  if (!Array.isArray(json) || json.some((entry) => typeof entry !== 'string')) {
    throw new MapClientError('Failed to list ink sidecars: unexpected response');
  }
  return listInkStoryIdsFromEntries(
    json.map((entry) => (entry.endsWith('.ink') ? entry : `${name}.${entry}.ink`)),
    name,
  );
}

/** Unique ink `storyId`s referenced by `showDialogue` commands (nested branches included). */
export function listInkStoryIdsFromEvents(
  events: Readonly<Record<string, readonly EventCommand[]>>,
): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const walk = (commands: readonly EventCommand[]) => {
    for (const command of commands) {
      if (command.type === 'showDialogue' && command.source.kind === 'ink') {
        const id = command.source.storyId;
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      } else if (command.type === 'conditional') {
        walk(command.then);
        if (command.else) walk(command.else);
      }
    }
  };
  for (const script of Object.values(events)) walk(script);
  return ids;
}

export type TryCompileInkResult =
  | { readonly ok: true; readonly knotCount: number }
  | { readonly ok: false; readonly issues: readonly InkIssue[] };

/** Live-compile helper for the text panel (never throws). */
export function tryCompileInkSource(source: string): TryCompileInkResult {
  try {
    compileInk(source);
    return { ok: true, knotCount: listInkKnots(source).length };
  } catch (error) {
    if (error instanceof InkCompileError) {
      return { ok: false, issues: error.issues };
    }
    return {
      ok: false,
      issues: [{ type: 'error', message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

/** Loads one sidecar next to the named map, or `null` if missing. */
export async function loadInkSidecar(
  storyId: string,
  mapName: string = LEGACY_MAP_NAME,
): Promise<string | null> {
  const relative = inkSidecarRelativePath(mapFileRelativePath(mapName), storyId);
  if (isTauriAvailable()) {
    const fileExists = await exists(relative, { baseDir: BaseDirectory.Home });
    if (!fileExists) return null;
    return readTextFile(relative, { baseDir: BaseDirectory.Home });
  }
  const nameQuery = mapName === LEGACY_MAP_NAME ? '' : `&name=${encodeURIComponent(mapName)}`;
  const response = await fetch(
    `${DEV_MAP_API_BASE}/ink?storyId=${encodeURIComponent(storyId)}${nameQuery}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapClientError(`Failed to load ink sidecar: HTTP ${response.status}`);
  }
  return response.text();
}

/** Saves one sidecar next to the named map (creates maps dir if needed). */
export async function saveInkSidecar(
  storyId: string,
  source: string,
  mapName: string = LEGACY_MAP_NAME,
): Promise<void> {
  const relative = inkSidecarRelativePath(mapFileRelativePath(mapName), storyId);
  if (isTauriAvailable()) {
    await mkdir(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
    await writeTextFile(relative, source, { baseDir: BaseDirectory.Home });
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/ink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storyId,
      source,
      ...(mapName === LEGACY_MAP_NAME ? {} : { name: mapName }),
    }),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to save ink sidecar: HTTP ${response.status}`);
  }
}

/** Re-export structure helpers used by the ink panel / graph. */
export { buildInkGraphModel, listInkKnots, parseInkNodeLayouts, setInkNodePosition };
