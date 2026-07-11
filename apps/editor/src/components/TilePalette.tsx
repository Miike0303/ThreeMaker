/**
 * Visual, clickable tileset-image palette (gate-review REQUIRED FEATURE:
 * "un selector de tiles en donde ir pintando, como en RPG Maker"). Renders
 * one composed slot's real sheet image as a grid of cropped swatches, one
 * per `computePaletteCells` entry; clicking a cell selects that cell's
 * already-resolved tile id (see `tile-palette.ts` for the pixel/kind<->id
 * math -- this component is pure presentation/wiring, untested per this
 * repo's established convention for thin React components, e.g.
 * `PainterPanel.tsx`/`CatalogBrowser.tsx`).
 */
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { SheetPixelSize } from '@threemaker/renderer';
import { TILE_SIZE_PX } from '@threemaker/renderer';
import { computePaletteCells, computePaletteColumns } from '../tile-palette.js';

export interface TilePaletteProps {
  readonly label: string;
  readonly sheet: TileSheetId;
  readonly imageUrl: string;
  readonly pixelSize: SheetPixelSize;
  readonly selectedTileId: number;
  readonly onSelect: (tileId: number) => void;
  readonly tileAriaLabel: (tileId: number) => string;
}

/** On-screen swatch size in px -- independent of the source image's 48px tile size, just a compact display scale. */
const THUMBNAIL_PX = 28;

export function TilePalette({
  label,
  sheet,
  imageUrl,
  pixelSize,
  selectedTileId,
  onSelect,
  tileAriaLabel,
}: TilePaletteProps) {
  const cells = computePaletteCells(sheet, pixelSize);
  const cols = computePaletteColumns(sheet, pixelSize);
  const backgroundWidth = (pixelSize.width / TILE_SIZE_PX) * THUMBNAIL_PX;
  const backgroundHeight = (pixelSize.height / TILE_SIZE_PX) * THUMBNAIL_PX;

  return (
    <div className="tile-palette-group">
      <p className="tile-palette-label">{label}</p>
      <div
        className="tile-palette"
        style={{ gridTemplateColumns: `repeat(${cols}, ${THUMBNAIL_PX}px)` }}
      >
        {cells.map((cell) => (
          <button
            key={cell.tileId}
            type="button"
            aria-label={tileAriaLabel(cell.tileId)}
            className={
              cell.tileId === selectedTileId
                ? 'tile-palette-cell tile-palette-cell-selected'
                : 'tile-palette-cell'
            }
            style={{
              width: THUMBNAIL_PX,
              height: THUMBNAIL_PX,
              backgroundImage: `url(${imageUrl})`,
              backgroundPosition: `-${(cell.x / TILE_SIZE_PX) * THUMBNAIL_PX}px -${(cell.y / TILE_SIZE_PX) * THUMBNAIL_PX}px`,
              backgroundSize: `${backgroundWidth}px ${backgroundHeight}px`,
            }}
            onClick={() => onSelect(cell.tileId)}
          />
        ))}
      </div>
    </div>
  );
}
