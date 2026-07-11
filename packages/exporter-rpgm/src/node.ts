/**
 * Node-only export execution: copies the MZ blank template, overwrites the
 * generated data files, copies referenced sheet PNGs out of the asset
 * object store, and writes the version marker. Reuses `project-mz.ts`'s pure
 * projection core unchanged (design's "one TS implementation, testable
 * headless, browser-entry rule holds") -- this file is the Node-only `/node`
 * subpath, never imported from the editor's webview bundle (see
 * `no-node-in-bundle.test.ts`'s convention across this repo).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { MapDocument, TileSheetSlot } from '@threemaker/map-format';
import { TILE_SHEET_SLOTS } from '@threemaker/map-format';
import { isValidMarkerLine, MARKER_FILE_NAME, resolveMarkerValue } from './marker.js';
import type { ExportReport } from './project-mz.js';
import {
  buildExportReport,
  buildMapInfosJson,
  buildMapJson,
  buildTilesetsJson,
  sheetFileNameForSlot,
} from './project-mz.js';

export type ExportErrorCode = 'dest-exists' | 'object-missing' | 'template-missing';

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

const FAN_OUT_LEN = 2;

/** Same content-addressed layout as `@threemaker/assets`' object store (`objects/{sha[0:2]}/{sha}`) -- duplicated rather than imported to keep `exporter-rpgm` decoupled from the catalog package (it only ever needs to READ raw bytes by hash, never scan/ingest). */
function objectPath(storeDir: string, sha256: string): string {
  return join(storeDir, 'objects', sha256.slice(0, FAN_OUT_LEN), sha256);
}

/** Fixed map id for v1 single-working-map export (matches the editor's single-working-map model -- see `map-client.ts`). */
const EXPORTED_MAP_ID = 1;
const EXPORTED_TILESET_ID = 1;

export interface ExportProjectOptions {
  /** Directory containing a full, unmodified MZ blank-project template (real installs: `<engine>/newdata`; tests: a synthetic fixture -- never a repo-committed copy of engine files). */
  readonly templateDir: string;
  /** Destination project folder. Must not already exist (or be empty) -- this function never silently overwrites an unrelated existing folder. */
  readonly outDir: string;
  /** Asset object store root (contains `objects/{sha[0:2]}/{sha}`). */
  readonly storeDir: string;
  readonly map: MapDocument;
  /** A cheaply-detected installed-engine marker value (see `findInstalledMarkerVersion`), or `null` to use the empirical fallback. Resolved via `resolveMarkerValue`. */
  readonly markerVersion: string | null;
}

export interface ExportResult {
  readonly outDir: string;
  readonly report: ExportReport;
  readonly markerValueUsed: string;
  readonly copiedSheetFiles: readonly string[];
}

function isEffectivelyEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

/**
 * Runs the full export pipeline synchronously (bulk-copy + a handful of
 * small generated-file writes -- synchronous IO keeps this a simple,
 * single-call operation for both the CLI and the dev-server export endpoint,
 * matching this repo's existing `map-api.ts`/`object-store.ts` convention of
 * plain sync `node:fs` calls rather than promise-based IO).
 */
export function runExport(options: ExportProjectOptions): ExportResult {
  const { templateDir, outDir, storeDir, map, markerVersion } = options;

  if (!existsSync(templateDir)) {
    throw new ExportError('template-missing', `Template directory not found: ${templateDir}`);
  }
  if (!isEffectivelyEmpty(outDir)) {
    throw new ExportError(
      'dest-exists',
      `Export destination already exists and is not empty: ${outDir}`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  cpSync(templateDir, outDir, { recursive: true });

  const sheetFileNames: Partial<Record<TileSheetSlot, string>> = {};
  const copiedSheetFiles: string[] = [];
  const tilesetsImgDir = join(outDir, 'img', 'tilesets');
  mkdirSync(tilesetsImgDir, { recursive: true });

  for (const slot of TILE_SHEET_SLOTS) {
    const source = map.tileset.slots[slot];
    if (!source?.object) continue;

    const sha256 = source.object;
    const srcPath = objectPath(storeDir, sha256);
    if (!existsSync(srcPath)) {
      throw new ExportError(
        'object-missing',
        `Slot "${slot}" references object "${sha256}" which was not found in the store at ${srcPath}.`,
      );
    }

    const baseName = sheetFileNameForSlot(slot, sha256);
    sheetFileNames[slot] = baseName;
    const destFileName = `${baseName}.png`;
    cpSync(srcPath, join(tilesetsImgDir, destFileName));
    copiedSheetFiles.push(destFileName);
  }

  const dataDir = join(outDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'Tilesets.json'),
    JSON.stringify(buildTilesetsJson(map, sheetFileNames, EXPORTED_TILESET_ID)),
  );
  writeFileSync(
    join(dataDir, 'MapInfos.json'),
    JSON.stringify(buildMapInfosJson(EXPORTED_MAP_ID, map.name)),
  );
  writeFileSync(
    join(dataDir, `Map${String(EXPORTED_MAP_ID).padStart(3, '0')}.json`),
    JSON.stringify(buildMapJson(map, EXPORTED_TILESET_ID)),
  );

  const markerValueUsed = resolveMarkerValue(markerVersion);
  writeFileSync(join(outDir, MARKER_FILE_NAME), markerValueUsed, 'utf8');

  return {
    outDir,
    report: buildExportReport(map),
    markerValueUsed,
    copiedSheetFiles,
  };
}

const MARKER_SCAN_MAX_DEPTH = 4;

/**
 * Bounded-depth, deterministically-ordered (alphabetical at each level)
 * search under `engineDir` for the first valid `game.rmmzproject` marker
 * file -- design's "cheaply detectable" resolution path (a). Real installed
 * engines don't ship a marker at their root; DLC sample projects a few
 * levels down do (see apply-progress's exploration notes). Never throws on
 * a missing/unreadable directory -- returns `null` instead, so callers
 * always have the empirical fallback available.
 */
export function findInstalledMarkerVersion(
  engineDir: string,
  maxDepth: number = MARKER_SCAN_MAX_DEPTH,
): string | null {
  return scanForMarker(engineDir, maxDepth);
}

function scanForMarker(dir: string, depthRemaining: number): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return null;
  }

  if (entries.includes(MARKER_FILE_NAME)) {
    try {
      const contents = readFileSync(join(dir, MARKER_FILE_NAME), 'utf8').trim();
      if (isValidMarkerLine(contents)) return contents;
    } catch {
      // fall through to subdirectory scan
    }
  }

  if (depthRemaining <= 0) return null;

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const found = scanForMarker(fullPath, depthRemaining - 1);
    if (found !== null) return found;
  }

  return null;
}
