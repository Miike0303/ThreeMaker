/**
 * Pure pixel<->tile-id math for the painter's visual tile-palette grid
 * (gate-review REQUIRED FEATURE: "un selector de tiles en donde ir
 * pintando, como en RPG Maker" -- a numeric fill-tile-id input alone does
 * not satisfy that). Renders each composed slot's real tileset sheet as a
 * clickable grid of cells; every cell already carries its resolved tile
 * id, so no click-time pixel math is needed in the presentational layer
 * (see `components/TilePalette.tsx`) -- only the CELL GENERATION below is
 * pure logic, which is what gets TDD'd here.
 *
 * - B/C/D/E/A5 ("plain" sheets): mirrors the EXACT addressing
 *   `@threemaker/renderer`'s `computeGridUv` (packages/renderer/src/geometry/tile-uv.ts)
 *   already uses to render these tiles -- two side-by-side 8-column
 *   blocks, local index 0-127 in the left block, 128+ in the right. Grid
 *   size is derived from the REAL loaded image's pixel size (same
 *   defensive fallback as the renderer), so a click always resolves to
 *   the exact same tile the renderer would draw there.
 * - A1-A4 (autotile sheets): one selectable cell per "kind" (base id =
 *   sheet's starting id + kind*48, always shape 0 -- corescript's
 *   fully-connected interior piece, which is ALWAYS one plain uncropped
 *   48x48 tile, never a blended/cropped composite -- verified against
 *   every case in packages/renderer/test/autotile-tables.test.ts). The
 *   swatch's crop origin reuses `@threemaker/renderer`'s
 *   `computeAutotileQuarterOrigins` (the exact same tested addressing the
 *   renderer itself uses for that tile), NOT a re-derivation of each
 *   sheet's native scattered block layout.
 *
 * Autotile palette scope (deliberate, documented simplification): the
 * literal RPGM sheet image places autotile "kinds" at irregular native
 * pixel positions (floor/wall blocks of different heights, and A1's first
 * 4 "special" kinds don't even follow the general tx/ty grid). Reproducing
 * that native layout pixel-for-pixel across all 4 autotile sheet types is
 * out of scope for this batch -- this module instead renders a clean
 * synthetic 8-column grid of per-kind swatches (real crops, just
 * re-arranged), and caps kind counts conservatively (see
 * `AUTOTILE_KIND_COUNT_CAP` / `AUTOTILE_ROW_TILE_HEIGHT`) so a very tall
 * loaded image can never produce a tile id spilling into the next sheet's
 * range.
 */
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { AutotileSheetId, SheetPixelSize } from '@threemaker/renderer';
import { computeAutotileQuarterOrigins, TILE_SIZE_PX } from '@threemaker/renderer';

export type PlainSheetId = Exclude<TileSheetId, AutotileSheetId>;

/**
 * Starting tile id of each sheet's range -- mirrors
 * `packages/importer-rpgm/src/tile-id.ts`'s private `SHEET_RANGES` table
 * (not exported from that package) and `apps/editor/src/map-compose.ts`'s
 * independently-duplicated `SLOT_ID_RANGES`. Kept as a third small,
 * self-contained copy here (rather than importing map-compose.ts's) so
 * this UI-only module stays decoupled from the map-composition module.
 */
const SHEET_BASE_ID: Readonly<Record<TileSheetId, number>> = {
  B: 0,
  C: 256,
  D: 512,
  E: 768,
  A5: 1536,
  A1: 2048,
  A2: 2816,
  A3: 4352,
  A4: 5888,
};

/** Highest valid local index + 1 for each plain sheet (id range size), so a taller-than-expected image never grows the grid past what that sheet can actually address. */
const PLAIN_SHEET_MAX_LOCAL_INDEX: Readonly<Record<PlainSheetId, number>> = {
  B: 256,
  C: 256,
  D: 256,
  E: 256,
  A5: 512,
};

const PLAIN_SHEETS: ReadonlySet<TileSheetId> = new Set(['A5', 'B', 'C', 'D', 'E']);

/** True for the "plain" grid sheets (B/C/D/E/A5); false for the autotile sheets (A1-A4). */
export function isPlainSheet(sheet: TileSheetId): sheet is PlainSheetId {
  return PLAIN_SHEETS.has(sheet);
}

function isAutotileSheet(sheet: TileSheetId): sheet is AutotileSheetId {
  return !PLAIN_SHEETS.has(sheet);
}

export interface PaletteGridDimensions {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Column/row count of a PLAIN sheet's clickable grid: derived from the
 * real loaded image size (same `Math.max(1, ...)` defensive fallback as
 * `computeGridUv`), capped at 16 cols (two 8-col blocks) and at that
 * sheet's own valid id range worth of rows.
 */
export function computePlainGridDimensions(
  sheet: PlainSheetId,
  pixelSize: SheetPixelSize,
): PaletteGridDimensions {
  const cols = Math.min(16, Math.max(1, Math.floor(pixelSize.width / TILE_SIZE_PX)));
  const maxRows = Math.max(1, Math.ceil(PLAIN_SHEET_MAX_LOCAL_INDEX[sheet] / 16));
  const rows = Math.min(maxRows, Math.max(1, Math.floor(pixelSize.height / TILE_SIZE_PX)));
  return { cols, rows };
}

/** Inverts `computeGridUv`'s column/block addressing: given a grid column/row, resolves that cell's local index within the sheet (0-127 left block, 128+ right block). */
function resolvePlainLocalIndex(col: number, row: number): number {
  const block = Math.floor(col / 8) % 2;
  return block * 128 + row * 8 + (col % 8);
}

/**
 * Autotile "kind" rows-per-sheet, in whole 48px tiles -- matches
 * `packages/renderer/src/geometry/autotile-tables.ts`'s `resolveA2`
 * (3 tiles/row) and `resolveA3` (2 tiles/row) exactly. A4 alternates
 * floor(3-tile)/wall(2-tile) rows; 2.5 is the exact PAIR-average (accurate
 * over any even number of rows, even though any single row individually
 * is really 2 or 3 tiles tall). A1's kind layout is irregular (its first 4
 * "special" kinds don't follow the tx/ty grid at all) -- rather than guess
 * at its native geometry, A1 is capped at the standard single 8-kind
 * water+waterfall row regardless of image height (see
 * `AUTOTILE_KIND_COUNT_CAP`); this row height is unused for A1 in
 * practice but kept for type completeness.
 */
const AUTOTILE_ROW_TILE_HEIGHT: Readonly<Record<AutotileSheetId, number>> = {
  A1: 6,
  A2: 3,
  A3: 2,
  A4: 2.5,
};

/** Highest valid kind index + 1 for each autotile sheet (id range size / 48) -- prevents a very tall loaded image from ever producing a kind whose base id spills into the NEXT sheet's range. */
const AUTOTILE_KIND_COUNT_CAP: Readonly<Record<AutotileSheetId, number>> = {
  A1: 8, // standard single water+waterfall row -- see AUTOTILE_ROW_TILE_HEIGHT's doc comment.
  A2: 32,
  A3: 32,
  A4: 48,
};

/** Number of selectable "kind" cells for a loaded autotile sheet image (8 kinds per row, corescript's `tx = kind % 8`), bounded by both the image's real pixel height and that sheet's own valid id range. */
export function computeAutotileKindCount(
  sheet: AutotileSheetId,
  pixelSize: SheetPixelSize,
): number {
  const rowHeightPx = AUTOTILE_ROW_TILE_HEIGHT[sheet] * TILE_SIZE_PX;
  const rows = Math.max(1, Math.floor(pixelSize.height / rowHeightPx));
  return Math.min(rows * 8, AUTOTILE_KIND_COUNT_CAP[sheet]);
}

/** Base (shape 0) tile id for one autotile kind index. */
export function resolveAutotileKindTileId(sheet: AutotileSheetId, kind: number): number {
  return SHEET_BASE_ID[sheet] + kind * 48;
}

/**
 * Top-left pixel corner of a kind's shape-0 swatch on its sheet image.
 * Shape 0 (the fully-connected interior piece) always composes from 4
 * CONTIGUOUS quarter-tiles forming one plain 48x48 square (verified
 * against every case in `packages/renderer/test/autotile-tables.test.ts`),
 * so the minimum corner of `computeAutotileQuarterOrigins`'s 4 origins is
 * exactly that square's origin -- no separate block-layout re-derivation
 * needed.
 */
function computeAutotileSwatchOrigin(
  kind: number,
  sheet: AutotileSheetId,
): { readonly x: number; readonly y: number } {
  const origins = computeAutotileQuarterOrigins(resolveAutotileKindTileId(sheet, kind), sheet);
  return {
    x: Math.min(...origins.map((origin) => origin.x)),
    y: Math.min(...origins.map((origin) => origin.y)),
  };
}

/** Number of columns a palette grid should render for `sheet` -- the real image's column count for plain sheets, always 8 (kinds per row) for autotile sheets. */
export function computePaletteColumns(sheet: TileSheetId, pixelSize: SheetPixelSize): number {
  if (isAutotileSheet(sheet)) return 8;
  return computePlainGridDimensions(sheet, pixelSize).cols;
}

/** One clickable/renderable palette cell: the tile id it selects, and the source-image pixel rect its thumbnail should crop from. */
export interface PaletteCell {
  readonly tileId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Every clickable cell for one loaded tileset sheet image, in row-major
 * order. Plain sheets (B/C/D/E/A5) enumerate every grid cell the real
 * image's pixel size supports; autotile sheets (A1-A4) enumerate one cell
 * per selectable "kind" (see `computeAutotileKindCount`).
 */
export function computePaletteCells(
  sheet: TileSheetId,
  pixelSize: SheetPixelSize,
): readonly PaletteCell[] {
  if (isAutotileSheet(sheet)) {
    const kindCount = computeAutotileKindCount(sheet, pixelSize);
    const cells: PaletteCell[] = [];
    for (let kind = 0; kind < kindCount; kind++) {
      const origin = computeAutotileSwatchOrigin(kind, sheet);
      cells.push({
        tileId: resolveAutotileKindTileId(sheet, kind),
        x: origin.x,
        y: origin.y,
        width: TILE_SIZE_PX,
        height: TILE_SIZE_PX,
      });
    }
    return cells;
  }

  const { cols, rows } = computePlainGridDimensions(sheet, pixelSize);
  const cells: PaletteCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        tileId: SHEET_BASE_ID[sheet] + resolvePlainLocalIndex(col, row),
        x: col * TILE_SIZE_PX,
        y: row * TILE_SIZE_PX,
        width: TILE_SIZE_PX,
        height: TILE_SIZE_PX,
      });
    }
  }
  return cells;
}
