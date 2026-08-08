/**
 * Ink sidecar authoring seams for the editor (L4 WU-02).
 *
 * Path convention matches desktop `authored-map.ts` design D7:
 * `.threemaker/maps/current.tmmap.json` → `.threemaker/maps/current.<storyId>.ink`
 *
 * Persistence reuses the same Tauri / dev-HTTP backends as `map-client.ts`.
 */

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { EventCommand } from '@threemaker/core';
import {
  compileInk,
  InkCompileError,
  type InkIssue,
  listInkKnots,
  parseInkNodeLayouts,
} from '@threemaker/narrative';
import { isTauriAvailable } from './catalog-client.js';
import { MAP_DIR_RELATIVE, MAP_FILE_RELATIVE, MapClientError } from './map-client.js';

const DEV_MAP_API_BASE = '/api/dev-map';
const MAP_FILE_SUFFIX = '.tmmap.json';
const SAFE_STORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Same charset gate desktop load uses before building a sidecar path. */
export function isSafeStoryId(storyId: string): boolean {
  return SAFE_STORY_ID_PATTERN.test(storyId);
}

/**
 * Home-relative (or maps-root-relative) path for one story's `.ink` sidecar.
 * Throws when `storyId` is not path-safe.
 */
export function inkSidecarRelativePath(mapRelativePath: string, storyId: string): string {
  if (!isSafeStoryId(storyId)) {
    throw new MapClientError(
      `Ink story id ${JSON.stringify(storyId)} is not path-safe (letters, digits, "_" and "-" only).`,
    );
  }
  const base = mapRelativePath.endsWith(MAP_FILE_SUFFIX)
    ? mapRelativePath.slice(0, -MAP_FILE_SUFFIX.length)
    : mapRelativePath;
  return `${base}.${storyId}.ink`;
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

/** Loads one sidecar for the working map, or `null` if missing. */
export async function loadInkSidecar(storyId: string): Promise<string | null> {
  const relative = inkSidecarRelativePath(MAP_FILE_RELATIVE, storyId);
  if (isTauriAvailable()) {
    const fileExists = await exists(relative, { baseDir: BaseDirectory.Home });
    if (!fileExists) return null;
    return readTextFile(relative, { baseDir: BaseDirectory.Home });
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/ink?storyId=${encodeURIComponent(storyId)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapClientError(`Failed to load ink sidecar: HTTP ${response.status}`);
  }
  return response.text();
}

/** Saves one sidecar for the working map (creates maps dir if needed). */
export async function saveInkSidecar(storyId: string, source: string): Promise<void> {
  const relative = inkSidecarRelativePath(MAP_FILE_RELATIVE, storyId);
  if (isTauriAvailable()) {
    await mkdir(MAP_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
    await writeTextFile(relative, source, { baseDir: BaseDirectory.Home });
    return;
  }
  const response = await fetch(`${DEV_MAP_API_BASE}/ink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storyId, source }),
  });
  if (!response.ok) {
    throw new MapClientError(`Failed to save ink sidecar: HTTP ${response.status}`);
  }
}

/** Re-export layout helpers for the future graph panel (WU-03). */
export { listInkKnots, parseInkNodeLayouts };
