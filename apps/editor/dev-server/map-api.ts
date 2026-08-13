// Node-side helper for `vite.config.ts`'s dev-only map-persistence
// middleware (Slice 4: "map format save"). Named maps live outside the repo
// under `~/.threemaker/maps/{name}.tmmap.json` — never committable by
// construction. Ink sidecars (L4 WU-02) share the same maps directory.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname } from 'node:path';
import {
  existingMapDocumentFileName,
  mapDocumentFileName,
  mapNameFromDocumentFileName,
} from '../src/map-identity.js';

export function saveMapFile(path: string, json: string): void {
  const dir = dirname(path);
  const base = basename(path);
  const stem = mapNameFromDocumentFileName(base);
  if (stem !== null && existsSync(dir)) {
    const existing = existingMapDocumentFileName(stem, listDirectoryNames(dir));
    if (existing !== undefined && existing !== mapDocumentFileName(stem)) {
      throw new Error(`Map ${JSON.stringify(stem)} already exists`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, json, 'utf8');
}

/** Returns the raw JSON text, or `null` if no map has been saved yet. */
export function loadMapFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** Raw `.ink` text, or `null` if the sidecar does not exist. */
export function loadInkFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** Writes a `.ink` sidecar next to the working map. */
export function saveInkFile(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

/** Directory entry names, or `[]` when the directory does not exist. */
export function listDirectoryNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

export function renameFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

export function deleteFile(path: string): void {
  if (!existsSync(path)) return;
  unlinkSync(path);
}
