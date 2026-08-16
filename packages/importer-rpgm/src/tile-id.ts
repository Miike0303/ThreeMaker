/**
 * RPG Maker MV/MZ tile ID decoding.
 *
 * The tileset image is split into 9 fixed sheets (A1-A5, B, C, D, E), each
 * with a fixed tile ID range. IDs 2048 and above (sheets A1-A4) are
 * autotiles: each "kind" (a distinct autotile pattern, e.g. one specific
 * water or cliff tile) spans exactly 48 consecutive IDs — one per shape
 * variant (0-47), used by the renderer to pick the right blob-tile piece per
 * neighbor configuration. This mirrors `Tilemap.TILE_ID_*` /
 * `Tilemap.getAutotileKind` in RPG Maker's `rmmz_core.js` corescript — the
 * reference implementation this package targets.
 */

export type TileSheetId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'C' | 'D' | 'E';

export interface SheetIdRange {
  readonly sheet: TileSheetId;
  readonly start: number;
  readonly end: number; // exclusive
}

// Ranges as documented in Tilemap.TILE_ID_* (rmmz_core.js). 1024-1535 is an
// unused gap between E and A5 that exists in the real format.
export const SHEET_ID_RANGES: readonly SheetIdRange[] = [
  { sheet: 'B', start: 0, end: 256 },
  { sheet: 'C', start: 256, end: 512 },
  { sheet: 'D', start: 512, end: 768 },
  { sheet: 'E', start: 768, end: 1024 },
  { sheet: 'A5', start: 1536, end: 2048 },
  { sheet: 'A1', start: 2048, end: 2816 },
  { sheet: 'A2', start: 2816, end: 4352 },
  { sheet: 'A3', start: 4352, end: 5888 },
  { sheet: 'A4', start: 5888, end: 8192 },
];

const AUTOTILE_BASE = 2048; // Tilemap.TILE_ID_A1
const AUTOTILE_IDS_PER_KIND = 48;

/** Autotiles (A1-A4) start at tile ID 2048; anything below is a single-frame tile. */
export function isAutotile(tileId: number): boolean {
  return tileId >= AUTOTILE_BASE;
}

/**
 * Index of the autotile pattern this tile ID belongs to, counted across the
 * whole A1-A4 autotile space (48 IDs per kind, matching corescript). Only
 * meaningful for autotile IDs — check `isAutotile` first.
 */
export function getAutotileKind(tileId: number): number {
  return Math.floor((tileId - AUTOTILE_BASE) / AUTOTILE_IDS_PER_KIND);
}

/**
 * Which of a kind's 48 "blob tile" shape variants this tile ID selects
 * (0-47), matching `Tilemap.getAutotileShape` in corescript exactly:
 * `(tileId - TILE_ID_A1) % 48`. Only meaningful for autotile IDs — check
 * `isAutotile` first. Combined with `getAutotileKind`, this is the pair the
 * renderer's quarter-tile composition tables are indexed by.
 */
export function getAutotileShape(tileId: number): number {
  return (tileId - AUTOTILE_BASE) % AUTOTILE_IDS_PER_KIND;
}

/**
 * Which of the 9 tileset sheets a tile ID belongs to. Returns `null` for the
 * unused 1024-1535 gap or for IDs outside the valid 0-8191 range.
 */
/** Starting tile id of each sheet (same table as {@link SHEET_ID_RANGES}). */
export const SHEET_BASE_ID: Readonly<Record<TileSheetId, number>> = {
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

/** Exclusive end id of each sheet's range. */
export const SHEET_END_ID: Readonly<Record<TileSheetId, number>> = {
  B: 256,
  C: 512,
  D: 768,
  E: 1024,
  A5: 2048,
  A1: 2816,
  A2: 4352,
  A3: 5888,
  A4: 8192,
};

export function getTileSheet(tileId: number): TileSheetId | null {
  for (const range of SHEET_ID_RANGES) {
    if (tileId >= range.start && tileId < range.end) {
      return range.sheet;
    }
  }
  return null;
}

/**
 * Index of a tile within its own sheet (0-based). `null` if the ID doesn't
 * belong to any sheet (see `getTileSheet`).
 */
export function getLocalTileIndex(tileId: number): number | null {
  for (const range of SHEET_ID_RANGES) {
    if (tileId >= range.start && tileId < range.end) {
      return tileId - range.start;
    }
  }
  return null;
}
