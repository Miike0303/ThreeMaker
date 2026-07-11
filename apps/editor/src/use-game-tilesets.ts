/**
 * Thin data-fetching hook: the tilesets belonging to one game, for a
 * game+tileset picker dropdown. Extracted from `PainterPanel.tsx`'s two
 * near-identical `useEffect` blocks (one per composed slot) -- gate-review
 * WARNING fix. Thin IO wrapper around `catalog-client.ts`'s
 * `listTilesetsForGame`, left untested per this repo's established
 * convention for thin React data-fetching glue (see `catalog-client.ts`'s
 * module doc: the pure URL/mapping helpers are tested, the IO calls
 * themselves are not).
 */
import { useEffect, useState } from 'react';
import { listTilesetsForGame } from './catalog-client.js';

export interface TilesetOption {
  readonly id: number;
  readonly label: string;
}

/** Tileset options for `gameId`'s picker dropdown; empty while `gameId` is unset or still loading. */
export function useGameTilesets(gameId: number | undefined): readonly TilesetOption[] {
  const [tilesets, setTilesets] = useState<readonly TilesetOption[]>([]);

  useEffect(() => {
    if (gameId === undefined) {
      setTilesets([]);
      return;
    }
    listTilesetsForGame(gameId)
      .then((rows) =>
        setTilesets(rows.map((row) => ({ id: row.id, label: row.name ?? `#${row.id}` }))),
      )
      .catch((err) => console.error('Failed to load tilesets for game:', err));
  }, [gameId]);

  return tilesets;
}
