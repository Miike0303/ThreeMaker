// Node-side helper for `vite.config.ts`'s dev-only map-persistence
// middleware (Slice 4: "map format save"). A single working map file, kept
// outside the repo (same asset-store directory the catalog already lives
// in) -- never committable by construction, same convention as the catalog
// db/object store. Ink sidecars (L4 WU-02) share the same maps directory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function saveMapFile(path: string, json: string): void {
  mkdirSync(dirname(path), { recursive: true });
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
