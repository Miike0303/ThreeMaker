// Resolves one RPGM tileset's sheet slots into map-format v3's
// `SlotComposition`, for the `convert-rpgm` CLI's optional `--store` catalog
// lookup. Pure database read -- never mutates the catalog.
import { dirname, resolve } from 'node:path';
import type { SlotComposition, SlotSource, TileSheetSlot } from '@threemaker/map-format';
import type { Catalog } from './catalog.js';

/**
 * Matches the given RPGM game directory to an already-cataloged game
 * case-insensitively (Windows filesystems are case-insensitive, and a
 * `gameDir` argument typed by hand rarely matches the exact byte-casing a
 * prior `catalog` scan stored -- same reasoning as `getAssetByRelPath`'s own
 * `COLLATE NOCASE`, see commit 9fc1267), then looks up that game's tileset by
 * its RPGM numeric id and builds one `SlotSource` per linked sheet.
 *
 * Fail-soft: a game or tileset that can't be matched in the catalog returns
 * `{}` rather than throwing -- every slot then stays unsourced, and
 * `apps/desktop/src/authored-map.ts`'s per-slot resolver simply skips it,
 * same as an unconverted map (the spike's existing W1 convention).
 */
export function resolveRpgmSlotsFromCatalog(
  catalog: Catalog,
  gameDir: string,
  rpgmTilesetId: number,
): SlotComposition {
  const resolvedGameDir = resolve(gameDir);
  const normalizedGameDir = resolvedGameDir.toLowerCase();
  const slashNormalizedGameDir = normalizedGameDir.replace(/\\/g, '/');
  const candidateRoots = [normalizedGameDir];
  if (slashNormalizedGameDir.endsWith('/data')) {
    candidateRoots.push(resolve(dirname(resolvedGameDir)).toLowerCase());
  }
  if (slashNormalizedGameDir.endsWith('/www/data')) {
    candidateRoots.push(resolve(dirname(dirname(resolvedGameDir))).toLowerCase());
  }

  const games = catalog.listGames();
  const game =
    games.find((candidate) => resolve(candidate.rootPath).toLowerCase() === normalizedGameDir) ??
    candidateRoots
      .slice(1)
      .map((root) => games.find((candidate) => resolve(candidate.rootPath).toLowerCase() === root))
      .find((candidate) => candidate !== undefined);
  if (!game) return {};

  const tilesetSummary = catalog
    .listTilesetsForGame(game.id)
    .find((candidate) => candidate.rpgmId === rpgmTilesetId);
  if (!tilesetSummary) return {};

  const tileset = catalog.getTileset(tilesetSummary.id);
  if (!tileset) return {};

  const slots: Partial<Record<TileSheetSlot, SlotSource>> = {};
  for (const sheet of tileset.sheets) {
    slots[sheet.slot] = {
      object: sheet.sha256,
      sourceTilesetId: tileset.id,
      sourceGameId: game.id,
    };
  }
  return slots;
}
