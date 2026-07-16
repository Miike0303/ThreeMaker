#!/usr/bin/env -S node --experimental-strip-types
// CLI: `scan` (Slice 1, catalog-free) and `catalog` (Slice 2 — scan + decrypt
// + hash + store + record into a rebuildable SQLite catalog) over a
// directory of RPG Maker MV/MZ games. Run via `tsx` (see the root `scan`
// script) — this file is intentionally not part of the package's public
// exports, since it's a Node-only entry point, not a library API.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { convertRpgmMap } from '@threemaker/importer-rpgm';
import { loadProject } from '@threemaker/importer-rpgm/node';
import { serializeMapDocument, validateCurrentVersionShape } from '@threemaker/map-format';
import type { IngestGameResult } from './catalog.js';
import { ingestGame, openCatalog, sumResults } from './catalog.js';
import { buildFailuresByCode } from './failures-by-code.js';
import { resolveRpgmSlotsFromCatalog } from './resolve-rpgm-slots.js';
import { scanGames } from './scanner.js';
import { ingestTilesetsForGame } from './tileset-ingest.js';

const DEFAULT_STORE_DIR = join(homedir(), '.threemaker', 'asset-store');

function printUsage(): void {
  console.error('Usage: tsx src/cli.ts scan <rootDir> [--max-depth <n>]');
  console.error('Usage: tsx src/cli.ts catalog <rootDir> [--store <dir>] [--max-depth <n>]');
  console.error('Usage: tsx src/cli.ts ingest-tilesets [--store <dir>]');
  console.error(
    'Usage: tsx src/cli.ts convert-rpgm <gameDir> <mapId> --out <file.tmmap> [--store <dir>]',
  );
}

interface ScanOrCatalogArgs {
  readonly command: 'scan' | 'catalog';
  readonly rootDir: string;
  readonly maxDepth?: number;
  readonly storeDir?: string;
}

interface IngestTilesetsArgs {
  readonly command: 'ingest-tilesets';
  readonly storeDir?: string;
}

interface ConvertRpgmArgs {
  readonly command: 'convert-rpgm';
  readonly gameDir: string;
  readonly mapId: number;
  readonly outPath: string;
  readonly storeDir?: string;
}

type ParsedArgs = ScanOrCatalogArgs | IngestTilesetsArgs | ConvertRpgmArgs;

function parseStoreOnlyArgs(
  command: 'ingest-tilesets',
  rest: readonly string[],
): IngestTilesetsArgs | null {
  let storeDir: string | undefined;
  const storeFlagIndex = rest.indexOf('--store');
  if (storeFlagIndex !== -1) {
    storeDir = rest[storeFlagIndex + 1];
    if (!storeDir) return null;
  }
  return { command, ...(storeDir === undefined ? {} : { storeDir }) };
}

/** `convert-rpgm <gameDir> <mapId> --out <file> [--store <dir>]` — two positionals + one required flag + one optional flag, unlike every other command's single positional. */
function parseConvertRpgmArgs(rest: readonly string[]): ConvertRpgmArgs | null {
  const [gameDir, mapIdRaw, ...flags] = rest;
  if (!gameDir || !mapIdRaw) return null;
  const mapId = Number.parseInt(mapIdRaw, 10);
  if (Number.isNaN(mapId)) return null;

  const outFlagIndex = flags.indexOf('--out');
  if (outFlagIndex === -1) return null;
  const outPath = flags[outFlagIndex + 1];
  if (!outPath) return null;

  let storeDir: string | undefined;
  const storeFlagIndex = flags.indexOf('--store');
  if (storeFlagIndex !== -1) {
    storeDir = flags[storeFlagIndex + 1];
    if (!storeDir) return null;
  }

  return { command: 'convert-rpgm', gameDir, mapId, outPath, ...(storeDir ? { storeDir } : {}) };
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [command, ...afterCommand] = argv;
  if (command === 'ingest-tilesets') {
    return parseStoreOnlyArgs(command, afterCommand);
  }
  if (command === 'convert-rpgm') {
    return parseConvertRpgmArgs(afterCommand);
  }

  const [rootDir, ...rest] = afterCommand;
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

function runIngestTilesets(storeDir: string): void {
  const dbPath = join(storeDir, 'catalog.db');
  const catalog = openCatalog(dbPath);
  try {
    const games = catalog.listGames();
    let gamesFailed = 0;
    // Per-game error isolation (same convention as runCatalog/ingestGame): a
    // single game with a malformed Tilesets.json (real-world games DO ship
    // these -- e.g. a corrupt/truncated flags array) must not abort the
    // whole multi-game run.
    const perGame = games.map((game) => {
      try {
        return {
          rootPath: game.rootPath,
          ok: true as const,
          ...ingestTilesetsForGame(catalog, game),
        };
      } catch (err) {
        gamesFailed++;
        const message = err instanceof Error ? err.message : String(err);
        return { rootPath: game.rootPath, ok: false as const, message };
      }
    });
    const totals = perGame.reduce(
      (acc, game) => ({
        tilesetsProcessed: acc.tilesetsProcessed + (game.ok ? game.tilesetsProcessed : 0),
        sheetsLinked: acc.sheetsLinked + (game.ok ? game.sheetsLinked : 0),
        sheetsSkipped: acc.sheetsSkipped + (game.ok ? game.sheetsSkipped : 0),
      }),
      { tilesetsProcessed: 0, sheetsLinked: 0, sheetsSkipped: 0 },
    );
    console.log(
      JSON.stringify(
        { storeDir, dbPath, gamesProcessed: games.length, gamesFailed, totals, perGame },
        null,
        2,
      ),
    );
  } finally {
    catalog.close();
  }
}

/**
 * Best-effort read of RPGM's `System.json` `startMapId`/`startX`/`startY`,
 * returning a player-start position only when `mapId` IS the project's
 * configured start map. Duplicates `load-project.ts`'s private data-dir
 * candidate search (`dir`, `dir/data`, `dir/www/data`) rather than exporting
 * it for this one 3-line reuse (ponytail: hoist a real `parseSystem` into
 * `@threemaker/importer-rpgm` if this CLI ever needs more `System.json`
 * fields than just the start position).
 */
function readPlayerStartIfStartMap(
  gameDir: string,
  mapId: number,
): { readonly x: number; readonly y: number } | undefined {
  const candidates = [gameDir, join(gameDir, 'data'), join(gameDir, 'www', 'data')];
  for (const dir of candidates) {
    const systemPath = join(dir, 'System.json');
    if (!existsSync(systemPath)) continue;
    try {
      const system = JSON.parse(readFileSync(systemPath, 'utf8')) as {
        readonly startMapId?: number;
        readonly startX?: number;
        readonly startY?: number;
      };
      if (
        system.startMapId === mapId &&
        typeof system.startX === 'number' &&
        typeof system.startY === 'number'
      ) {
        return { x: system.startX, y: system.startY };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function runConvertRpgm(
  gameDir: string,
  mapId: number,
  outPath: string,
  storeDir?: string,
): Promise<void> {
  const project = await loadProject(gameDir);
  const map = project.maps.get(mapId);
  if (!map) {
    console.error(
      `convert-rpgm: no Map${String(mapId).padStart(3, '0')}.json found under "${gameDir}".`,
    );
    process.exitCode = 1;
    return;
  }
  const tileset = project.tilesets.find((entry) => entry.id === map.tilesetId);
  if (!tileset) {
    console.error(
      `convert-rpgm: map ${mapId} references tilesetId ${map.tilesetId}, which was not found in Tilesets.json.`,
    );
    process.exitCode = 1;
    return;
  }

  // [--store] catalog-backed slot wiring: fail-soft, same convention as every
  // other lookup in this CLI -- a missing/unreadable catalog never aborts the
  // conversion, it just leaves every slot unsourced (matching the no-`--store`
  // behavior exactly).
  let slots = {};
  if (storeDir) {
    const dbPath = join(storeDir, 'catalog.db');
    const catalog = openCatalog(dbPath);
    try {
      slots = resolveRpgmSlotsFromCatalog(catalog, gameDir, tileset.id);
    } finally {
      catalog.close();
    }
  }

  const playerStart = readPlayerStartIfStartMap(gameDir, mapId);
  const doc = convertRpgmMap(map, tileset, {
    id: `rpgm-map-${mapId}`,
    slots,
    ...(playerStart ? { playerStart } : {}),
  });

  // [N1] Validate the shape we are about to write, not just trust the
  // converter -- catches a future schema drift between `convertRpgmMap`'s
  // output and `MapDocument` before it ever reaches disk.
  validateCurrentVersionShape(doc);

  writeFileSync(outPath, serializeMapDocument(doc), 'utf8');

  const slotsResolved = Object.keys(slots).length;
  console.log(
    JSON.stringify(
      {
        gameDir,
        mapId,
        outPath,
        name: doc.name,
        width: doc.width,
        height: doc.height,
        isStartMap: playerStart !== undefined,
        spawn: doc.spawn ?? null,
        slotsResolved,
      },
      null,
      2,
    ),
  );
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
    const scanErrorBaselineId = catalog.getMaxScanErrorId();
    const scanResult = scanGames(rootDir, maxDepth === undefined ? {} : { maxDepth });

    for (const error of scanResult.errors) {
      catalog.insertScanError({
        gameId: null,
        relPath: error.path,
        code: error.code,
        message: error.message,
      });
    }

    let gamesFailed = 0;
    const ingestResults: IngestGameResult[] = [];

    const perGame = scanResult.games.map((game) => {
      try {
        const result = ingestGame(catalog, game, { storeDir });
        ingestResults.push(result);
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

    const totals = sumResults(ingestResults);
    const dedupeStats = catalog.getDedupeStats();
    const durationMs = Date.now() - startedAt;

    const failuresByCode = buildFailuresByCode(catalog.listScanErrors(), scanErrorBaselineId);

    const summary = {
      rootDir,
      storeDir,
      dbPath,
      gamesScanned: scanResult.games.length,
      gamesFailed,
      scanErrorCount: scanResult.errors.length,
      filesSeen: totals.filesSeen,
      filesFailed: totals.filesFailed,
      uniqueObjectsCreatedThisRun: totals.objectsCreated,
      totalAssetsCataloged: dedupeStats.assetCount,
      totalDistinctObjects: dedupeStats.distinctObjectCount,
      dedupeRatio:
        dedupeStats.assetCount > 0
          ? Number((dedupeStats.distinctObjectCount / dedupeStats.assetCount).toFixed(4))
          : 0,
      bytesScannedThisRun: totals.bytesScanned,
      bytesStoredThisRun: totals.bytesStored,
      durationMs,
      failuresByCode,
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

  if (parsed.command === 'ingest-tilesets') {
    runIngestTilesets(parsed.storeDir ?? DEFAULT_STORE_DIR);
    return;
  }

  if (parsed.command === 'convert-rpgm') {
    void runConvertRpgm(parsed.gameDir, parsed.mapId, parsed.outPath, parsed.storeDir).catch(
      (error: unknown) => {
        console.error('convert-rpgm: failed.', error);
        process.exitCode = 1;
      },
    );
    return;
  }

  if (parsed.command === 'scan') {
    runScan(parsed.rootDir, parsed.maxDepth);
    return;
  }

  runCatalog(parsed.rootDir, parsed.maxDepth, parsed.storeDir ?? DEFAULT_STORE_DIR);
}

main(process.argv.slice(2));
