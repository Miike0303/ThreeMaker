/**
 * Host I/O for versioned game saves (PLAN_DEV_2 C3 WU-02).
 *
 * Single autosave slot for the exit criterion (save → quit → reopen). Path:
 * `$HOME/.threemaker/saves/current.json`. Multi-slot can grow under
 * `saves/` later without changing the document schema.
 *
 * Same pattern as `input-bindings-store.ts`: Tauri Home fs + localStorage
 * fallback; write is best-effort and never blocks play. Parse stays pure in
 * `@threemaker/save`.
 */

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { GameSaveSnapshot } from '@threemaker/save';
import {
  gameSaveDocumentFromSnapshot,
  parseGameSaveJson,
  serializeGameSaveDocument,
  snapshotFromGameSaveDocument,
} from '@threemaker/save';
import { isTauriAvailable } from './tauri-env.js';

/** Directory under Home for save slots. */
export const GAME_SAVES_DIR_RELATIVE = '.threemaker/saves';
/** Single-slot file (C3 exit criterion; multi-slot is optional later). */
export const GAME_SAVE_FILE_RELATIVE = `${GAME_SAVES_DIR_RELATIVE}/current.json`;
/** localStorage key when Tauri fs is unavailable. */
export const GAME_SAVE_STORAGE_KEY = 'threemaker:game-save';

export type TextStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read raw JSON text, or null when nothing is stored / I/O fails. */
export async function readGameSaveText(
  storage: TextStore | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<string | null> {
  if (isTauriAvailable()) {
    try {
      const fileExists = await exists(GAME_SAVE_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
      if (!fileExists) return null;
      return await readTextFile(GAME_SAVE_FILE_RELATIVE, { baseDir: BaseDirectory.Home });
    } catch {
      return null;
    }
  }
  if (!storage) return null;
  try {
    return storage.getItem(GAME_SAVE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist raw JSON text (best-effort). */
export async function writeGameSaveText(
  text: string,
  storage: TextStore | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<void> {
  if (isTauriAvailable()) {
    try {
      await mkdir(GAME_SAVES_DIR_RELATIVE, { baseDir: BaseDirectory.Home, recursive: true });
      await writeTextFile(GAME_SAVE_FILE_RELATIVE, text, { baseDir: BaseDirectory.Home });
    } catch {
      // Save persistence must never block play.
    }
    return;
  }
  if (!storage) return;
  try {
    storage.setItem(GAME_SAVE_STORAGE_KEY, text);
  } catch {
    // Best-effort only.
  }
}

/** Write a runtime snapshot as a versioned document. */
export async function persistGameSaveSnapshot(
  snapshot: GameSaveSnapshot,
  storage?: TextStore | null,
): Promise<void> {
  const doc = gameSaveDocumentFromSnapshot(snapshot);
  await writeGameSaveText(serializeGameSaveDocument(doc), storage);
}

export type LoadGameSaveResult =
  | { readonly ok: true; readonly snapshot: GameSaveSnapshot }
  | { readonly ok: false; readonly reason: string };

/**
 * Read + parse into a snapshot. Fail-closed; never throws.
 * Placement against a real map is the caller's job ({@link validateSavePlacement}).
 */
export async function loadGameSaveSnapshot(
  storage?: TextStore | null,
): Promise<LoadGameSaveResult> {
  const text = await readGameSaveText(storage);
  const parsed = parseGameSaveJson(text);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  return { ok: true, snapshot: snapshotFromGameSaveDocument(parsed.document) };
}
