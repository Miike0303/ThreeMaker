// Node-only: populates `tilesets`/`tileset_sheets` for an already-cataloged
// game by re-reading its (cheap, JSON-only) Tilesets.json -- no
// re-decryption/re-hashing of image bytes, that already happened during the
// bulk `catalog` scan (Slice 2). Needed so the editor's slot-composition
// painting (Slice 4) has real tileset rows to compose maps from.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTilesets } from '@threemaker/importer-rpgm';
import type { Catalog, GameRow, TilesetSlot } from './catalog.js';

export interface TilesetIngestResult {
  readonly tilesetsProcessed: number;
  readonly sheetsLinked: number;
  /** A sheet slot was named in Tilesets.json but its asset wasn't found in the catalog (e.g. an unused slot, or the game wasn't fully cataloged). Logged, never fatal. */
  readonly sheetsSkipped: number;
}

/** RPG Maker MV nests its data folder under `www/`; MZ does not (same convention as `catalog.ts`'s ingestion pipeline). */
function assetRootForGameRow(game: GameRow): string {
  return game.engine === 'mv' ? join(game.rootPath, 'www') : game.rootPath;
}

/**
 * The catalog stores a game's ORIGINAL on-disk extension for every asset
 * (see `scanner.ts`'s `IMAGE_EXTENSIONS`), which for an encrypted game is
 * `.png_` (or the legacy `.rpgmvp`), not the plain `.png` `Tilesets.json`
 * always implies. Tried in the same order the scanner recognizes them.
 */
const CANDIDATE_IMAGE_EXTENSIONS: readonly string[] = ['.png', '.png_', '.rpgmvp'];

function resolveSheetAsset(
  catalog: Catalog,
  gameId: number,
  sheetName: string,
): ReturnType<Catalog['getAssetByRelPath']> {
  for (const extension of CANDIDATE_IMAGE_EXTENSIONS) {
    const asset = catalog.getAssetByRelPath(gameId, `img/tilesets/${sheetName}${extension}`);
    if (asset) return asset;
  }
  return null;
}

/**
 * Populates `tilesets`/`tileset_sheets` for one game already present in
 * `games`. Idempotent: re-running updates existing rows (matched by
 * `(game_id, rpgm_id)` for tilesets, `(tileset_id, slot)` for sheets)
 * instead of duplicating them. Returns a zero-result summary (not an error)
 * if the game has no `Tilesets.json` reachable -- a game scanned before
 * this feature existed, or one missing that file, shouldn't abort a
 * multi-game run.
 */
export function ingestTilesetsForGame(catalog: Catalog, game: GameRow): TilesetIngestResult {
  const tilesetsPath = join(assetRootForGameRow(game), 'data', 'Tilesets.json');
  if (!existsSync(tilesetsPath)) {
    return { tilesetsProcessed: 0, sheetsLinked: 0, sheetsSkipped: 0 };
  }

  const json = JSON.parse(readFileSync(tilesetsPath, 'utf8'));
  const tilesets = parseTilesets(json);

  let sheetsLinked = 0;
  let sheetsSkipped = 0;
  for (const tileset of tilesets) {
    const tilesetId = catalog.upsertTileset({
      gameId: game.id,
      rpgmId: tileset.id,
      name: tileset.name,
      flags: JSON.stringify(tileset.flags),
    });

    for (const [slot, sheetName] of Object.entries(tileset.sheetNames) as [TilesetSlot, string][]) {
      if (!sheetName) continue;
      const asset = resolveSheetAsset(catalog, game.id, sheetName);
      if (!asset) {
        sheetsSkipped++;
        continue;
      }
      catalog.upsertTilesetSheet({ tilesetId, slot, assetId: asset.id });
      sheetsLinked++;
    }
  }

  return { tilesetsProcessed: tilesets.length, sheetsLinked, sheetsSkipped };
}
