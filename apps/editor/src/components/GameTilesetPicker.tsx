/**
 * One "pick a game, then pick one of its tilesets" control. Extracted from
 * `PainterPanel.tsx`'s two near-identical label/select blocks (game A and
 * game B) -- gate-review WARNING fix. Parameterized by which composed slot
 * it drives (via `label`); the caller (`PainterPanel`) owns the actual
 * `gameId`/`tilesetId` selection state, since it needs both slots' ids
 * together to compose the map.
 */
import type { GameRow } from '../catalog-client.js';
import { useGameTilesets } from '../use-game-tilesets.js';

export interface GameTilesetPickerProps {
  readonly label: string;
  readonly games: readonly GameRow[];
  readonly gameId: number | undefined;
  readonly onGameChange: (gameId: number | undefined) => void;
  readonly tilesetId: number | undefined;
  readonly onTilesetChange: (tilesetId: number | undefined) => void;
  readonly selectGameLabel: string;
  readonly selectTilesetLabel: string;
}

export function GameTilesetPicker({
  label,
  games,
  gameId,
  onGameChange,
  tilesetId,
  onTilesetChange,
  selectGameLabel,
  selectTilesetLabel,
}: GameTilesetPickerProps) {
  const tilesets = useGameTilesets(gameId);

  return (
    <label>
      {label}
      <select
        value={gameId ?? ''}
        onChange={(event) =>
          onGameChange(event.target.value ? Number(event.target.value) : undefined)
        }
      >
        <option value="">{selectGameLabel}</option>
        {games.map((game) => (
          <option key={game.id} value={game.id}>
            {game.title ?? game.rootPath}
          </option>
        ))}
      </select>
      <select
        value={tilesetId ?? ''}
        onChange={(event) =>
          onTilesetChange(event.target.value ? Number(event.target.value) : undefined)
        }
        disabled={tilesets.length === 0}
      >
        <option value="">{selectTilesetLabel}</option>
        {tilesets.map((tileset) => (
          <option key={tileset.id} value={tileset.id}>
            {tileset.label}
          </option>
        ))}
      </select>
    </label>
  );
}
