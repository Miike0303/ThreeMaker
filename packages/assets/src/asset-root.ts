import { join } from 'node:path';

export interface AssetRootGame {
  readonly engine: 'mv' | 'mz';
  readonly rootPath: string;
}

/**
 * RPG Maker MV nests its data/asset folders under `www/`; MZ does not.
 * Shared by `catalog.ts`'s per-file ingestion pipeline (`GameRecord`) and
 * `tileset-ingest.ts`'s `Tilesets.json` re-read (`GameRow`) -- both had an
 * identical private `assetRootFor`/`assetRootForGameRow` function before this
 * gate-review dedup fix (see `asset-root.test.ts`).
 */
export function assetRootForGame(game: AssetRootGame): string {
  return game.engine === 'mv' ? join(game.rootPath, 'www') : game.rootPath;
}
