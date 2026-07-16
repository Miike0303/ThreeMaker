import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMap } from './parse-map.js';
import { parseMapInfos } from './parse-map-infos.js';
import { parseTilesets } from './parse-tilesets.js';
import type { RpgmMap, RpgmProject } from './types.js';

const MAP_FILE_PATTERN = /^Map(\d+)\.json$/;

/**
 * Locates the actual data folder for an RPG Maker MV/MZ project given its
 * root. Accepts three shapes: `dir` is already the data folder, `<dir>/data`
 * (MZ, or an MV project without the `www` wrapper), or `<dir>/www/data`
 * (a typical deployed MV game).
 */
function resolveDataDir(dir: string): string {
  const candidates = [dir, join(dir, 'data'), join(dir, 'www', 'data')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'MapInfos.json'))) {
      return candidate;
    }
  }
  throw new Error(
    `Could not find an RPG Maker data folder under "${dir}" (tried: ${candidates.join(', ')}).`,
  );
}

/** Strips a leading UTF-8 BOM (U+FEFF) — some deployed games ship JSON re-saved by editors/translation tools that add one, which `JSON.parse` otherwise rejects. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readJson(filePath: string): Promise<unknown> {
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(stripBom(contents));
}

/**
 * Loads and parses `MapInfos.json`, `Tilesets.json`, and every `MapXXX.json`
 * found under `dir` (auto-detecting the MV/MZ data folder layout — see
 * `resolveDataDir`). Only the maps actually present on disk are parsed and
 * returned; this does not assume the full map tree from `MapInfos.json` is
 * available (fixtures typically only ship a handful of maps).
 *
 * Does not handle MZ's encrypted asset archives — the data folder must
 * already contain plain, unencrypted JSON.
 */
export async function loadProject(dir: string): Promise<RpgmProject> {
  const dataDir = resolveDataDir(dir);

  const [mapInfosJson, tilesetsJson] = await Promise.all([
    readJson(join(dataDir, 'MapInfos.json')),
    readJson(join(dataDir, 'Tilesets.json')),
  ]);

  const mapInfos = parseMapInfos(mapInfosJson);
  const tilesets = parseTilesets(tilesetsJson);

  const entries = await readdir(dataDir);
  const maps = new Map<number, RpgmMap>();
  for (const entry of entries) {
    const match = MAP_FILE_PATTERN.exec(entry);
    if (!match?.[1]) continue;
    const id = Number(match[1]);
    const mapJson = await readJson(join(dataDir, entry));
    maps.set(id, parseMap(mapJson, id));
  }

  return { mapInfos, tilesets, maps };
}
