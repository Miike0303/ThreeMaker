#!/usr/bin/env -S node --experimental-strip-types
// CLI: `scan` (Slice 1, catalog-free) and `catalog` (Slice 2 — scan + decrypt
// + hash + store + record into a rebuildable SQLite catalog) over a
// directory of RPG Maker MV/MZ games. Run via `tsx` (see the root `scan`
// script) — this file is intentionally not part of the package's public
// exports, since it's a Node-only entry point, not a library API.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ingestGame, openCatalog } from './catalog.js';
import { scanGames } from './scanner.js';

const DEFAULT_STORE_DIR = join(homedir(), '.threemaker', 'asset-store');

function printUsage(): void {
  console.error('Usage: tsx src/cli.ts scan <rootDir> [--max-depth <n>]');
  console.error('Usage: tsx src/cli.ts catalog <rootDir> [--store <dir>] [--max-depth <n>]');
}

interface ParsedArgs {
  readonly command: 'scan' | 'catalog';
  readonly rootDir: string;
  readonly maxDepth?: number;
  readonly storeDir?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [command, rootDir, ...rest] = argv;
  if ((command !== 'scan' && command !== 'catalog') || !rootDir) return null;

  let maxDepth: number | undefined;
  const maxDepthFlagIndex = rest.indexOf('--max-depth');
  if (maxDepthFlagIndex !== -1) {
    const value = rest[maxDepthFlagIndex + 1];
    const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
    if (Number.isNaN(parsed)) return null;
    maxDepth = parsed;
  }

  let storeDir: string | undefined;
  const storeFlagIndex = rest.indexOf('--store');
  if (storeFlagIndex !== -1) {
    storeDir = rest[storeFlagIndex + 1];
    if (!storeDir) return null;
  }

  return {
    command,
    rootDir,
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(storeDir === undefined ? {} : { storeDir }),
  };
}

function runScan(rootDir: string, maxDepth: number | undefined): void {
  const result = scanGames(rootDir, maxDepth === undefined ? {} : { maxDepth });

  const summary = {
    rootDir,
    gameCount: result.games.length,
    games: result.games.map((game) => ({
      rootPath: game.rootPath,
      engine: game.engine,
      hasEncryptedImages: game.hasEncryptedImages,
      hasEncryptedAudio: game.hasEncryptedAudio,
      imageAssetCount: game.imageAssets.length,
      audioAssetCount: game.audioAssets.length,
    })),
    errorCount: result.errors.length,
    errors: result.errors,
  };

  console.log(JSON.stringify(summary, null, 2));
}

function runCatalog(rootDir: string, maxDepth: number | undefined, storeDir: string): void {
  const startedAt = Date.now();
  const dbPath = join(storeDir, 'catalog.db');
  const catalog = openCatalog(dbPath);

  try {
    const scanResult = scanGames(rootDir, maxDepth === undefined ? {} : { maxDepth });

    for (const error of scanResult.errors) {
      catalog.insertScanError({
        gameId: null,
        relPath: error.path,
        code: error.code,
        message: error.message,
      });
    }

    let totalFilesSeen = 0;
    let totalFilesFailed = 0;
    let totalObjectsCreated = 0;
    let totalBytesScanned = 0;
    let totalBytesStored = 0;
    let gamesFailed = 0;

    const perGame = scanResult.games.map((game) => {
      try {
        const result = ingestGame(catalog, game, { storeDir });
        totalFilesSeen += result.filesSeen;
        totalFilesFailed += result.filesFailed;
        totalObjectsCreated += result.objectsCreated;
        totalBytesScanned += result.bytesScanned;
        totalBytesStored += result.bytesStored;
        return { rootPath: game.rootPath, ok: true as const, ...result };
      } catch (err) {
        gamesFailed++;
        const message = err instanceof Error ? err.message : String(err);
        catalog.insertScanError({
          gameId: null,
          relPath: game.rootPath,
          code: 'ingest-failed',
          message,
        });
        return { rootPath: game.rootPath, ok: false as const, message };
      }
    });

    const dedupeStats = catalog.getDedupeStats();
    const durationMs = Date.now() - startedAt;

    const errorsByCode = new Map<string, number>();
    for (const error of catalog.listScanErrors()) {
      errorsByCode.set(error.code, (errorsByCode.get(error.code) ?? 0) + 1);
    }

    const summary = {
      rootDir,
      storeDir,
      dbPath,
      gamesScanned: scanResult.games.length,
      gamesFailed,
      scanErrorCount: scanResult.errors.length,
      filesSeen: totalFilesSeen,
      filesFailed: totalFilesFailed,
      uniqueObjectsCreatedThisRun: totalObjectsCreated,
      totalAssetsCataloged: dedupeStats.assetCount,
      totalDistinctObjects: dedupeStats.distinctObjectCount,
      dedupeRatio:
        dedupeStats.assetCount > 0
          ? Number((dedupeStats.distinctObjectCount / dedupeStats.assetCount).toFixed(4))
          : 0,
      bytesScannedThisRun: totalBytesScanned,
      bytesStoredThisRun: totalBytesStored,
      durationMs,
      failuresByCode: Object.fromEntries(errorsByCode),
      perGame,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    catalog.close();
  }
}

function main(argv: readonly string[]): void {
  const parsed = parseArgs(argv);
  if (!parsed) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (parsed.command === 'scan') {
    runScan(parsed.rootDir, parsed.maxDepth);
    return;
  }

  runCatalog(parsed.rootDir, parsed.maxDepth, parsed.storeDir ?? DEFAULT_STORE_DIR);
}

main(process.argv.slice(2));
