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
 * Two independent safety nets bound every traversal (informed by a real
 * pathological game folder found during exploration, "LoQOO", whose
 * `output/output/output/...` folder self-nests far beyond any sane depth):
 * - a max-depth counter, which abandons (logs + skips) any branch deeper
 *   than `maxDepth`;
 * - a realpath-based visited set, which abandons any branch that revisits a
 *   real path already seen on this walk (symlink/junction cycles).
 *
 * Both nets live in a single `guardedWalk` helper, shared by the game-root
 * walk (`walkForGames`) and the per-game asset-tree walk
 * (`collectAssetFiles`). Each call to `guardedWalk` carries its OWN budget
 * and its OWN visited-paths set — the game-root walk and each game's
 * img/audio asset walk are intentionally independent traversals (a game
 * nested 10 folders deep should not "use up" depth budget before its own
 * `img/` tree is even scanned).
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
  /** Ground truth from `System.json`, NOT derived from whether a key happens to parse. */
  readonly hasEncryptedImages: boolean;
  /** Ground truth from `System.json`, NOT derived from whether a key happens to parse. */
  readonly hasEncryptedAudio: boolean;
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

  walkForGames(rootDir, maxDepth, games, errors);

  return { games, errors };
}

/**
 * Handlers for `guardedWalk`. `onDirectory` is called for every directory
 * that passed the depth+cycle guard, and decides whether to recurse into
 * its children (`true`) or treat it as a leaf (`false`). `onFile` is
 * optional and is called for every file found inside a directory being
 * recursed into.
 */
interface GuardedWalkHandlers {
  onDirectory(dir: string, depth: number): boolean;
  onFile?(entryPath: string, relPath: string): void;
}

/**
 * The single shared traversal primitive behind both the game-root walk and
 * the per-game asset-tree walk. Bounds itself with a max-depth counter and a
 * realpath-based visited set (see module doc), and follows directory
 * symlinks/junctions — `Dirent.isDirectory()` alone reports `false` for them
 * on Windows, which would otherwise silently defeat the cycle guard.
 *
 * `maxDepth` is this walk's OWN budget, starting fresh at depth 0 for
 * `rootDir` — callers that nest one guarded walk's root inside another
 * guarded walk's leaf (e.g. a game folder found by the game-root walk, then
 * its `img/` tree scanned separately) get independent budgets, by design.
 */
function guardedWalk(
  rootDir: string,
  maxDepth: number,
  errors: ScanError[],
  handlers: GuardedWalkHandlers,
): void {
  const visitedRealPaths = new Set<string>();

  const walk = (dir: string, depth: number, relPrefix: string): void => {
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

    if (!handlers.onDirectory(dir, depth)) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: dir, code: 'read-error', message: describeError(err) });
      return;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (isTraversableDirectory(entry, entryPath)) {
        walk(entryPath, depth + 1, relPath);
      } else if (entry.isFile()) {
        handlers.onFile?.(entryPath, relPath);
      }
    }
  };

  walk(rootDir, 0, '');
}

function walkForGames(
  rootDir: string,
  maxDepth: number,
  games: GameRecord[],
  errors: ScanError[],
): void {
  guardedWalk(rootDir, maxDepth, errors, {
    onDirectory: (dir) => {
      const detected = detectDataDir(dir);
      if (!detected) return true; // not a game root yet — keep recursing

      try {
        games.push(buildGameRecord(dir, detected, maxDepth, errors));
      } catch (err) {
        if (err instanceof ScanBuildError) {
          errors.push({ path: dir, code: err.code, message: err.message });
        } else {
          errors.push({ path: dir, code: 'read-error', message: describeError(err) });
        }
      }
      // A detected game root is treated as a leaf: its own subfolders
      // (img/, audio/, js/, save/...) are asset trees, not more game roots.
      return false;
    },
  });
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

/** Reads a boolean flag from `System.json`, defaulting to `false` when absent or not a boolean. */
function readBooleanFlag(systemJson: unknown, key: string): boolean {
  if (typeof systemJson !== 'object' || systemJson === null) return false;
  return (systemJson as Record<string, unknown>)[key] === true;
}

function buildGameRecord(
  rootPath: string,
  detected: DetectedDataDir,
  maxDepth: number,
  errors: ScanError[],
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
    systemJson = JSON.parse(stripBom(raw));
  } catch (err) {
    throw new ScanBuildError(
      'invalid-system-json',
      `Corrupt System.json at "${systemJsonPath}": ${describeError(err)}`,
    );
  }

  // Ground truth: read the flags as-is from System.json. A game can have a
  // parseable key with the flags off (key unused), or the flags on with no
  // parseable key (a broken/incomplete export) — Slice 2's decrypt decisions
  // need to see BOTH states faithfully, not a single derived "encrypted"
  // boolean that papers over the mismatch.
  const hasEncryptedImages = readBooleanFlag(systemJson, 'hasEncryptedImages');
  const hasEncryptedAudio = readBooleanFlag(systemJson, 'hasEncryptedAudio');
  const encryptionKey = parseEncryptionKey(systemJson);
  const assetRoot = dirname(detected.dataDir);

  return {
    rootPath,
    engine: detected.engine,
    hasEncryptedImages,
    hasEncryptedAudio,
    encryptionKey,
    imageAssets: collectAssetFiles(join(assetRoot, 'img'), IMAGE_EXTENSIONS, maxDepth, errors),
    audioAssets: collectAssetFiles(join(assetRoot, 'audio'), AUDIO_EXTENSIONS, maxDepth, errors),
  };
}

/** Recursively lists files under `dir` matching `extensions`, relative to `dir`. */
function collectAssetFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  maxDepth: number,
  errors: ScanError[],
): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];

  guardedWalk(dir, maxDepth, errors, {
    onDirectory: () => true, // asset trees have no "leaf" concept — always recurse
    onFile: (entryPath, relPath) => {
      if (extensions.has(extname(entryPath).toLowerCase())) {
        results.push(relPath);
      }
    },
  });

  return results.sort();
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strips a leading UTF-8 BOM (U+FEFF) — some deployed games ship `System.json` re-saved by editors/translation tools that add one, which `JSON.parse` otherwise rejects, skipping the whole game. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
