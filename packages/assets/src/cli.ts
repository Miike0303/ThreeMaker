#!/usr/bin/env -S node --experimental-strip-types
// Minimal Slice 1 CLI: run `scan` over a directory of RPG Maker MV/MZ games
// and print a summary. Run via `tsx` (see the root `scan` script) — this
// file is intentionally not part of the package's public exports, since
// it's a Node-only entry point, not a library API.
//
// No catalog/SQLite write here — that's Slice 2 (`scanGames` output feeds
// the object store + catalog in a later slice).
import { scanGames } from './scanner.js';

function printUsage(): void {
  console.error('Usage: tsx src/cli.ts scan <rootDir> [--max-depth <n>]');
}

function parseArgs(argv: readonly string[]): { rootDir: string; maxDepth?: number } | null {
  const [command, rootDir, ...rest] = argv;
  if (command !== 'scan' || !rootDir) return null;

  let maxDepth: number | undefined;
  const maxDepthFlagIndex = rest.indexOf('--max-depth');
  if (maxDepthFlagIndex !== -1) {
    const value = rest[maxDepthFlagIndex + 1];
    const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
    if (Number.isNaN(parsed)) return null;
    maxDepth = parsed;
  }

  return { rootDir, ...(maxDepth === undefined ? {} : { maxDepth }) };
}

function main(argv: readonly string[]): void {
  const parsed = parseArgs(argv);
  if (!parsed) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = scanGames(
    parsed.rootDir,
    parsed.maxDepth === undefined ? {} : { maxDepth: parsed.maxDepth },
  );

  const summary = {
    rootDir: parsed.rootDir,
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

main(process.argv.slice(2));
