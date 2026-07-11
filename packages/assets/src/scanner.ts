import type { Dirent } from 'node:fs';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { parseEncryptionKey } from './decrypt.js';

/**
 * Folder-agnostic scanner for RPG Maker MV/MZ game libraries. Walks an
 * arbitrary directory tree (games may be nested at any depth — e.g. grouped
 * by locale folders like `en/`, `es/`) looking for game roots, auto-detects
 * MV (`www/data`) vs MZ (`data`) layout per folder, and never lets one
 * corrupt or pathological game folder abort the whole run.
 *
 * Two independent safety nets bound the traversal (informed by a real
 * pathological game folder found during exploration, "LoQOO", whose
 * `output/output/output/...` folder self-nests far beyond any sane depth):
 * - a max-depth counter, which abandons (logs + skips) any branch deeper
 *   than `maxDepth`;
 * - a realpath-based visited set, which abandons any branch that revisits a
 *   real path already seen on this walk (symlink/junction cycles).
 */

const DEFAULT_MAX_DEPTH = 12;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.rpgmvp', '.png_']);
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ogg',
  '.m4a',
  '.rpgmvo',
  '.ogg_',
  '.m4a_',
]);

export interface GameRecord {
  readonly rootPath: string;
  readonly engine: 'mv' | 'mz';
  readonly encrypted: boolean;
  readonly encryptionKey: Uint8Array | null;
  readonly imageAssets: readonly string[];
  readonly audioAssets: readonly string[];
}

export type ScanErrorCode =
  | 'invalid-system-json'
  | 'read-error'
  | 'depth-exceeded'
  | 'cycle-detected';

export interface ScanError {
  readonly path: string;
  readonly code: ScanErrorCode;
  readonly message: string;
}

export interface ScanOptions {
  readonly maxDepth?: number;
}

export interface ScanResult {
  readonly games: readonly GameRecord[];
  readonly errors: readonly ScanError[];
}

interface DetectedDataDir {
  readonly dataDir: string;
  readonly engine: 'mv' | 'mz';
}

class ScanBuildError extends Error {
  readonly code: ScanErrorCode;

  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.name = 'ScanBuildError';
    this.code = code;
  }
}

/**
 * Scans `rootDir` for RPG Maker MV/MZ games at any nesting depth. Never
 * throws: per-folder failures (corrupt `System.json`, unreadable
 * directories, runaway/cyclic trees) are collected in the returned
 * `errors` array so one broken game never aborts the run.
 */
export function scanGames(rootDir: string, options: ScanOptions = {}): ScanResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const games: GameRecord[] = [];
  const errors: ScanError[] = [];
  const visitedRealPaths = new Set<string>();

  walkForGames(rootDir, 0, maxDepth, visitedRealPaths, games, errors);

  return { games, errors };
}

function walkForGames(
  dir: string,
  depth: number,
  maxDepth: number,
  visitedRealPaths: Set<string>,
  games: GameRecord[],
  errors: ScanError[],
): void {
  if (depth > maxDepth) {
    errors.push({
      path: dir,
      code: 'depth-exceeded',
      message: `Max scan depth (${maxDepth}) exceeded at "${dir}" — abandoning this branch.`,
    });
    return;
  }

  let realPath: string;
  try {
    realPath = realpathSync(dir);
  } catch (err) {
    errors.push({ path: dir, code: 'read-error', message: describeError(err) });
    return;
  }
  if (visitedRealPaths.has(realPath)) {
    errors.push({
      path: dir,
      code: 'cycle-detected',
      message: `Cycle detected at "${dir}" (real path "${realPath}" already visited) — abandoning this branch.`,
    });
    return;
  }
  visitedRealPaths.add(realPath);

  const detected = detectDataDir(dir);
  if (detected) {
    try {
      games.push(buildGameRecord(dir, detected, maxDepth));
    } catch (err) {
      if (err instanceof ScanBuildError) {
        errors.push({ path: dir, code: err.code, message: err.message });
      } else {
        errors.push({ path: dir, code: 'read-error', message: describeError(err) });
      }
    }
    // A detected game root is treated as a leaf: its own subfolders
    // (img/, audio/, js/, save/...) are asset trees, not more game roots.
    return;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    errors.push({ path: dir, code: 'read-error', message: describeError(err) });
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (isTraversableDirectory(entry, entryPath)) {
      walkForGames(entryPath, depth + 1, maxDepth, visitedRealPaths, games, errors);
    }
  }
}

/**
 * True for real directories AND directory symlinks/junctions. Junctions are
 * exactly the case that can form a real traversal cycle (a plain nested
 * folder tree cannot loop back on itself), so they must be followed —
 * `Dirent.isDirectory()` alone reports `false` for them on Windows.
 */
function isTraversableDirectory(entry: Dirent, entryPath: string): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

/** Detects the MV (`www/data`) vs MZ (`data`) layout for a candidate game folder. */
function detectDataDir(dir: string): DetectedDataDir | null {
  const mvDataDir = join(dir, 'www', 'data');
  if (existsSync(join(mvDataDir, 'System.json'))) {
    return { dataDir: mvDataDir, engine: 'mv' };
  }

  const mzDataDir = join(dir, 'data');
  if (existsSync(join(mzDataDir, 'System.json'))) {
    return { dataDir: mzDataDir, engine: 'mz' };
  }

  return null;
}

function buildGameRecord(
  rootPath: string,
  detected: DetectedDataDir,
  maxDepth: number,
): GameRecord {
  const systemJsonPath = join(detected.dataDir, 'System.json');

  let raw: string;
  try {
    raw = readFileSync(systemJsonPath, 'utf8');
  } catch (err) {
    throw new ScanBuildError(
      'read-error',
      `Could not read "${systemJsonPath}": ${describeError(err)}`,
    );
  }

  let systemJson: unknown;
  try {
    systemJson = JSON.parse(raw);
  } catch (err) {
    throw new ScanBuildError(
      'invalid-system-json',
      `Corrupt System.json at "${systemJsonPath}": ${describeError(err)}`,
    );
  }

  const encryptionKey = parseEncryptionKey(systemJson);
  const assetRoot = dirname(detected.dataDir);

  return {
    rootPath,
    engine: detected.engine,
    encrypted: encryptionKey !== null,
    encryptionKey,
    imageAssets: collectAssetFiles(join(assetRoot, 'img'), IMAGE_EXTENSIONS, maxDepth),
    audioAssets: collectAssetFiles(join(assetRoot, 'audio'), AUDIO_EXTENSIONS, maxDepth),
  };
}

/** Recursively lists files under `dir` matching `extensions`, relative to `dir`. */
function collectAssetFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  maxDepth: number,
): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  const visitedRealPaths = new Set<string>();

  const walk = (current: string, depth: number, relPrefix: string): void => {
    if (depth > maxDepth) return;

    let realPath: string;
    try {
      realPath = realpathSync(current);
    } catch {
      return;
    }
    if (visitedRealPaths.has(realPath)) return;
    visitedRealPaths.add(realPath);

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const entryPath = join(current, entry.name);
      if (isTraversableDirectory(entry, entryPath)) {
        walk(entryPath, depth + 1, relPath);
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        results.push(relPath);
      }
    }
  };

  walk(dir, 0, '');
  return results.sort();
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
