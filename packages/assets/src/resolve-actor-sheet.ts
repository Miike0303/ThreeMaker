// Resolves an RPGM game's lead-actor character sheet (`rpgm-actors.ts`'s
// `readLeadActorSheet`) into a cataloged sha256, for the `convert-rpgm-game`
// CLI's optional `--store` catalog lookup -- same game-matching convention
// as `resolve-rpgm-slots.ts`'s `resolveRpgmSlotsFromCatalog` (case-insensitive
// `gameDir` match against `catalog.listGames()`), reused here rather than
// duplicated logic since both resolve provenance for the same `gameDir`.
import { resolve } from 'node:path';
import type { Catalog } from './catalog.js';

export interface ActorSheetRef {
  /** Content-addressed sha256 of the character sheet PNG, resolvable via the asset catalog's object store. */
  readonly object: string;
  /** Which of the sheet's 8 character blocks (4 cols x 2 rows) the lead actor uses, 0-indexed. */
  readonly characterIndex: number;
}

/**
 * Matches `gameDir` to an already-cataloged game case-insensitively, then
 * looks up `img/characters/<characterName>.png` for that game.
 *
 * Fail-soft: returns `undefined` when the game isn't cataloged or the sheet
 * asset isn't cataloged under that exact relative path -- the caller (desktop)
 * falls back to the canvas-generated placeholder sprite, same convention as
 * `resolveRpgmSlotsFromCatalog`'s `{}` fail-soft return.
 */
export function resolveActorSheetFromCatalog(
  catalog: Catalog,
  gameDir: string,
  characterName: string,
  characterIndex: number,
): ActorSheetRef | undefined {
  const normalizedGameDir = resolve(gameDir).toLowerCase();
  const game = catalog
    .listGames()
    .find((candidate) => resolve(candidate.rootPath).toLowerCase() === normalizedGameDir);
  if (!game) return undefined;

  const asset = catalog.getAssetByRelPath(game.id, `img/characters/${characterName}.png`);
  if (!asset) return undefined;

  return { object: asset.sha256, characterIndex };
}
