import type { TileSheetId } from '@threemaker/importer-rpgm';
import { getLocalTileIndex, getTileSheet, isAutotile } from '@threemaker/importer-rpgm';
import type { AutotileSheetId } from './autotile-tables.js';
import { computeAutotileQuarterOrigins } from './autotile-tables.js';
import type { SheetPixelSize, SheetPixelSizes, UvRect } from './types.js';
import { TILE_SIZE_PX } from './types.js';

const QUARTER_SIZE_PX = TILE_SIZE_PX / 2;
const AUTOTILE_SHEETS: readonly AutotileSheetId[] = ['A1', 'A2', 'A3', 'A4'];

function isAutotileSheet(sheet: TileSheetId): sheet is AutotileSheetId {
  return (AUTOTILE_SHEETS as readonly TileSheetId[]).includes(sheet);
}

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

/**
 * Composes an autotile map tile id into its 4 quarter-tile UV rects (see
 * `computeAutotileQuarterOrigins`), in destination order [top-left,
 * top-right, bottom-left, bottom-right].
 */
function computeAutotileQuads(
  tileId: number,
  sheet: AutotileSheetId,
  pixelSize: SheetPixelSize,
): readonly [UvRect, UvRect, UvRect, UvRect] {
  const origins = computeAutotileQuarterOrigins(tileId, sheet);
  return origins.map((origin) =>
    pixelRectToUv(origin.x, origin.y, QUARTER_SIZE_PX, QUARTER_SIZE_PX, pixelSize),
  ) as unknown as [UvRect, UvRect, UvRect, UvRect];
}

function computeGridUv(tileId: number, pixelSize: SheetPixelSize): UvRect | null {
  const localIndex = getLocalTileIndex(tileId);
  if (localIndex === null) return null;

  // Corescript `Tilemap._addNormalTile` addressing: B-E (and A5) sheets are
  // two side-by-side 8-column blocks, NOT one image-wide row-major grid --
  // ids 0-127 fill the left block top-to-bottom, 128-255 the right block.
  // Getting this wrong reads unrelated art (the Map007 "dark diamond" bug:
  // B tile 77 must map to (240,432), a light pedestal base, not (624,192),
  // a black decor sprite). On A5's single-block 384px-wide image the right
  // block folds away naturally (ids stay below 128 in practice).
  const col = (Math.floor(localIndex / 128) % 2) * 8 + (localIndex % 8);
  const row = Math.floor((localIndex % 128) / 8);

  // Defensive modulo: RPG Maker reserves a wider ID range per sheet (e.g.
  // A5's 512 ids) than the shipped image typically uses -- ids beyond the
  // image are wrapped instead of reading out of bounds. Real map data is
  // not expected to reference those ids.
  const cols = Math.max(1, Math.floor(pixelSize.width / TILE_SIZE_PX));
  const rows = Math.max(1, Math.floor(pixelSize.height / TILE_SIZE_PX));
  const pixelX = (col % cols) * TILE_SIZE_PX;
  const pixelY = (row % rows) * TILE_SIZE_PX;
  return pixelRectToUv(pixelX, pixelY, TILE_SIZE_PX, TILE_SIZE_PX, pixelSize);
}

export interface TileUv {
  readonly sheet: TileSheetId;
  /**
   * 1 entry for a plain single-frame tile, or 4 quarter-tile entries (in
   * destination order [top-left, top-right, bottom-left, bottom-right]) for
   * an autotile -- see `computeAutotileQuads`.
   */
  readonly quads: readonly UvRect[];
}

/**
 * Resolves which sheet a tile id belongs to and its UV rect(s) within that
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

  if (isAutotile(tileId) && isAutotileSheet(sheet)) {
    return { sheet, quads: computeAutotileQuads(tileId, sheet, pixelSize) };
  }

  const uv = computeGridUv(tileId, pixelSize);
  return uv ? { sheet, quads: [uv] } : null;
}
