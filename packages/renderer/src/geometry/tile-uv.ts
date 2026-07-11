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

/**
 * Inset, in source-image pixels, applied to all 4 sides of every UV rect
 * this module produces before converting to UV space. Nearest quads share a
 * texture (all tiles of a sheet live on the one bound texture), so without
 * an inset, sampling right at a shared UV boundary can pick up a sliver of
 * the *neighboring* tile's pixels -- visible as a thin seam line between
 * tiles.
 *
 * A plain (non-mipmapped) texture only ever samples the base level, where
 * half a texel of margin is already enough headroom. The mipmapped
 * "environment" configuration (`pixel-art-texture.ts`'s `mipmaps: true`,
 * used for the HD-2D tileset look) is the harder case this constant is
 * actually sized for: anisotropic sampling at grazing camera angles (this
 * app's HD-2D tilt goes as low as 15 degrees, see `MIN_TILT_DEG` in
 * `camera-rig.ts`) stretches its sampling footprint along the view
 * direction, and that footprint can span past a half-texel margin into the
 * next tile even while still resolving mostly at the base mip level. A
 * bigger inset buys real headroom against that footprint overflow at the
 * mip levels this renderer's camera distances (3-24 world units) actually
 * use in practice.
 *
 * This does NOT fix bleeding baked into *coarser* mip levels: three.js's
 * `generateMipmaps` box-filters the whole shared atlas image per level,
 * unaware of per-tile boundaries, so at a high enough mip level a texel is
 * already an average that crossed into a neighboring tile's pixels -- no
 * runtime UV inset can undo that after the fact. The full fix is padding a
 * border of duplicated edge pixels around each tile in the source atlas
 * before mip generation (or hand-building a shorter, tile-aware mip chain);
 * out of scope for this slice -- see the ponytail note on
 * `PixelArtTextureOptions.mipmaps` in `pixel-art-texture.ts`.
 */
// Trade-off: the inset is flat per rect, so 24px autotile quarter-rects lose
// twice the proportional edge content of 48px full tiles (22/24 vs 46/48
// visible). Acceptable at current art scale; a per-rect-size inset is the
// refinement if quarter edges ever look visibly cropped.
const TILE_UV_INSET_PX = 1;

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
    u0: (x + TILE_UV_INSET_PX) / pixelSize.width,
    u1: (x + w - TILE_UV_INSET_PX) / pixelSize.width,
    v0: 1 - (y + h - TILE_UV_INSET_PX) / pixelSize.height,
    v1: 1 - (y + TILE_UV_INSET_PX) / pixelSize.height,
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
