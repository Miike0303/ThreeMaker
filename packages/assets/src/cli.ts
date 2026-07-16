#!/usr/bin/env -S node --experimental-strip-types
// CLI: `scan` (Slice 1, catalog-free) and `catalog` (Slice 2 — scan + decrypt
// + hash + store + record into a rebuildable SQLite catalog) over a
// directory of RPG Maker MV/MZ games. Run via `tsx` (see the root `scan`
// script) — this file is intentionally not part of the package's public
// exports, since it's a Node-only entry point, not a library API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadProject } from '@threemaker/importer-rpgm/node';
import { serializeMapDocument } from '@threemaker/map-format';
import type { Catalog, IngestGameResult } from './catalog.js';
import { ingestGame, openCatalog, sumResults } from './catalog.js';
import type { ConvertedMap, GameManifest } from './convert-rpgm-game.js';
import { convertRpgmGame, convertSingleRpgmMap } from './convert-rpgm-game.js';
import { buildFailuresByCode } from './failures-by-code.js';
import { resolveActorSheetFromCatalog } from './resolve-actor-sheet.js';
import { readLeadActorSheet } from './rpgm-actors.js';
import { readRpgmSystemStart } from './rpgm-system.js';
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
  console.error(
    'Usage: tsx src/cli.ts convert-rpgm-game <gameDir> --out-dir <dir> [--store <dir>]',
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

interface ConvertRpgmGameArgs {
  readonly command: 'convert-rpgm-game';
  readonly gameDir: string;
  readonly outDir: string;
  readonly storeDir?: string;
}

type ParsedArgs = ScanOrCatalogArgs | IngestTilesetsArgs | ConvertRpgmArgs | ConvertRpgmGameArgs;

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

/** `convert-rpgm-game <gameDir> --out-dir <dir> [--store <dir>]` — one positional + one required flag + one optional flag, same shape convention as `parseConvertRpgmArgs` minus the single `mapId` positional (every map in the game is converted). */
function parseConvertRpgmGameArgs(rest: readonly string[]): ConvertRpgmGameArgs | null {
  const [gameDir, ...flags] = rest;
  if (!gameDir) return null;

  const outDirFlagIndex = flags.indexOf('--out-dir');
  if (outDirFlagIndex === -1) return null;
  const outDir = flags[outDirFlagIndex + 1];
  if (!outDir) return null;

  let storeDir: string | undefined;
  const storeFlagIndex = flags.indexOf('--store');
  if (storeFlagIndex !== -1) {
    storeDir = flags[storeFlagIndex + 1];
    if (!storeDir) return null;
  }

  return { command: 'convert-rpgm-game', gameDir, outDir, ...(storeDir ? { storeDir } : {}) };
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [command, ...afterCommand] = argv;
  if (command === 'ingest-tilesets') {
    return parseStoreOnlyArgs(command, afterCommand);
  }
  if (command === 'convert-rpgm') {
    return parseConvertRpgmArgs(afterCommand);
  }
  if (command === 'convert-rpgm-game') {
    return parseConvertRpgmGameArgs(afterCommand);
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
 * Single-map conversion (the `convert-rpgm` command). Delegates the actual
 * conversion to `convertSingleRpgmMap` (`convert-rpgm-game.ts`) -- the same
 * function `runConvertRpgmGame`'s batch loop calls per map -- so this CLI
 * command and the batch command can never silently drift into two different
 * conversion behaviors.
 */
async function runConvertRpgm(
  gameDir: string,
  mapId: number,
  outPath: string,
  storeDir?: string,
): Promise<void> {
  const project = await loadProject(gameDir);

  let catalog: Catalog | undefined;
  if (storeDir) catalog = openCatalog(join(storeDir, 'catalog.db'));
  try {
    const systemStart = readRpgmSystemStart(gameDir);

    let result: ConvertedMap;
    try {
      result = convertSingleRpgmMap(project, mapId, gameDir, {
        ...(catalog ? { catalog } : {}),
        ...(systemStart ? { systemStart } : {}),
      });
    } catch (err) {
      console.error(`convert-rpgm: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    writeFileSync(outPath, serializeMapDocument(result.doc), 'utf8');

    console.log(
      JSON.stringify(
        {
          gameDir,
          mapId,
          outPath,
          name: result.doc.name,
          width: result.doc.width,
          height: result.doc.height,
          isStartMap: result.isStartMap,
          spawn: result.doc.spawn ?? null,
          slotsResolved: result.slotsResolved,
        },
        null,
        2,
      ),
    );
  } finally {
    catalog?.close();
  }
}

/**
 * Batch conversion: every map in the game (`convert-rpgm-game` command).
 * Loops `convertRpgmGame` (which itself calls `convertSingleRpgmMap` per
 * map, fail-soft) and writes one `.tmmap` file per converted map plus a
 * `manifest.json` listing them in order -- the desktop app's multi-map
 * navigation reads this manifest (`apps/desktop/src/game-manifest.ts`).
 */
async function runConvertRpgmGame(
  gameDir: string,
  outDir: string,
  storeDir?: string,
): Promise<void> {
  const project = await loadProject(gameDir);

  let catalog: Catalog | undefined;
  if (storeDir) catalog = openCatalog(join(storeDir, 'catalog.db'));
  try {
    const systemStart = readRpgmSystemStart(gameDir);
    const leadActor = readLeadActorSheet(gameDir);
    const actorSheet =
      leadActor && catalog
        ? resolveActorSheetFromCatalog(
            catalog,
            gameDir,
            leadActor.characterName,
            leadActor.characterIndex,
          )
        : undefined;

    const { converted, failed } = convertRpgmGame(project, gameDir, {
      ...(catalog ? { catalog } : {}),
      ...(systemStart ? { systemStart } : {}),
    });

    mkdirSync(outDir, { recursive: true });
    for (const entry of converted) {
      writeFileSync(join(outDir, entry.file), serializeMapDocument(entry.doc), 'utf8');
    }

    const manifest: GameManifest = {
      maps: converted.map(({ mapId, name, file, slotsResolved }) => ({
        mapId,
        name,
        file,
        slotsResolved,
      })),
      ...(actorSheet ? { actorSheet } : {}),
    };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const totalSlotsResolved = converted.reduce((sum, entry) => sum + entry.slotsResolved, 0);
    console.log(
      JSON.stringify(
        {
          gameDir,
          outDir,
          mapsConverted: converted.length,
          mapsFailed: failed.length,
          failures: failed,
          totalSlotsResolved,
          actorSheetName: leadActor?.characterName ?? null,
          actorSheetResolved: actorSheet !== undefined,
        },
        null,
        2,
      ),
    );
  } finally {
    catalog?.close();
  }
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

  if (parsed.command === 'convert-rpgm-game') {
    void runConvertRpgmGame(parsed.gameDir, parsed.outDir, parsed.storeDir).catch(
      (error: unknown) => {
        console.error('convert-rpgm-game: failed.', error);
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
