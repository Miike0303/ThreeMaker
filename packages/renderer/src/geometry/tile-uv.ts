import type { TileSheetId } from '@threemaker/importer-rpgm';
import {
  getAutotileKind,
  getLocalTileIndex,
  getTileSheet,
  isAutotile,
} from '@threemaker/importer-rpgm';
import type { SheetPixelSize, SheetPixelSizes, UvRect } from './types.js';
import { TILE_SIZE_PX } from './types.js';

type AutotileSheetId = 'A1' | 'A2' | 'A3' | 'A4';

// ponytail: real RPG Maker MV/MZ autotiles (A1-A4) compose each tile from up
// to 47 neighbor-dependent shape variants (the classic "blob tile" algorithm
// in Tilemap.prototype._drawTile), picking corner/edge pieces so adjacent
// autotiles blend seamlessly. That algorithm is out of scope for this slice.
// Instead, every one of a kind's 48 shape ids (see `getAutotileKind`) is
// rendered with the SAME fixed sub-tile: the top-left tile of that kind's
// block in the sheet image. Visually this means autotiles render as a flat
// repeated tile with no blending at their edges. Full 48-shape composition
// (reading each tile's 4/8-neighbor configuration from the map's own layer
// data) is a follow-up slice.
const AUTOTILE_BLOCK_COLS = 2;
const AUTOTILE_BLOCK_ROWS = 3;

// `getAutotileKind` counts kinds across the whole A1-A4 autotile ID space (see
// its doc comment in importer-rpgm). Each sheet's image only contains its own
// kinds, so this offset converts the whole-space kind index back to a
// per-sheet-local index before it is used to address the image.
const AUTOTILE_KIND_OFFSET: Record<AutotileSheetId, number> = {
  A1: 0,
  A2: 16,
  A3: 48,
  A4: 80,
};

function pixelRectToUv(
  x: number,
  y: number,
  w: number,
  h: number,
  pixelSize: SheetPixelSize,
): UvRect {
  // Image space has Y growing downward; three.js texture UV space has V
  // growing upward. Flip once here so every caller gets ready-to-use UVs.
  return {
    u0: x / pixelSize.width,
    u1: (x + w) / pixelSize.width,
    v0: 1 - (y + h) / pixelSize.height,
    v1: 1 - y / pixelSize.height,
  };
}

function computeAutotileUv(
  tileId: number,
  sheet: AutotileSheetId,
  pixelSize: SheetPixelSize,
): UvRect {
  const localKind = getAutotileKind(tileId) - AUTOTILE_KIND_OFFSET[sheet];
  const blockPixelWidth = AUTOTILE_BLOCK_COLS * TILE_SIZE_PX;
  const blockPixelHeight = AUTOTILE_BLOCK_ROWS * TILE_SIZE_PX;
  const blocksPerRow = Math.max(1, Math.floor(pixelSize.width / blockPixelWidth));

  const blockCol = localKind % blocksPerRow;
  const blockRow = Math.floor(localKind / blocksPerRow);

  const pixelX = blockCol * blockPixelWidth;
  const pixelY = blockRow * blockPixelHeight;
  return pixelRectToUv(pixelX, pixelY, TILE_SIZE_PX, TILE_SIZE_PX, pixelSize);
}

function computeGridUv(tileId: number, pixelSize: SheetPixelSize): UvRect | null {
  const localIndex = getLocalTileIndex(tileId);
  if (localIndex === null) return null;

  const cols = Math.max(1, Math.floor(pixelSize.width / TILE_SIZE_PX));
  const rows = Math.max(1, Math.floor(pixelSize.height / TILE_SIZE_PX));
  const col = localIndex % cols;
  // Defensive modulo: RPG Maker reserves a wider ID range per sheet (e.g. A5's
  // 512 ids) than the shipped image typically uses (e.g. an 8x16 = 128-tile
  // A5 image) -- padding ids beyond the image are wrapped instead of reading
  // out of bounds. Real map data is not expected to reference those ids.
  const row = Math.floor(localIndex / cols) % rows;

  const pixelX = col * TILE_SIZE_PX;
  const pixelY = row * TILE_SIZE_PX;
  return pixelRectToUv(pixelX, pixelY, TILE_SIZE_PX, TILE_SIZE_PX, pixelSize);
}

export interface TileUv {
  readonly sheet: TileSheetId;
  readonly uv: UvRect;
}

/**
 * Resolves which sheet a tile id belongs to and its UV rect within that
 * sheet's image, given the pixel sizes of the sheets actually loaded.
 * Returns `null` for an empty tile (id 0), an id outside all known sheet
 * ranges, or a sheet whose pixel size was not provided (not loaded/unused).
 */
export function computeTileUv(tileId: number, sheetPixelSizes: SheetPixelSizes): TileUv | null {
  if (tileId === 0) return null;

  const sheet = getTileSheet(tileId);
  if (!sheet) return null;

  const pixelSize = sheetPixelSizes[sheet];
  if (!pixelSize) return null;

  if (isAutotile(tileId)) {
    // Safe cast: isAutotile(tileId) === true implies tileId is in the A1-A4
    // range, so getTileSheet must have returned one of those 4 ids.
    const uv = computeAutotileUv(tileId, sheet as AutotileSheetId, pixelSize);
    return { sheet, uv };
  }

  const uv = computeGridUv(tileId, pixelSize);
  return uv ? { sheet, uv } : null;
}
