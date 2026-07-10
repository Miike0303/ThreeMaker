import { getAutotileKind, getAutotileShape } from '@threemaker/importer-rpgm';
import { TILE_SIZE_PX } from './types.js';

/**
 * RPG Maker MV/MZ autotiles compose each rendered tile from 4 quarter-tile
 * ("blob tile") pieces, picked by a per-kind shape id (0-47) from a lookup
 * table that maps to source-sheet quarter-tile coordinates. These tables and
 * the addressing math below are a direct TypeScript port of
 * `Tilemap.FLOOR_AUTOTILE_TABLE` / `WALL_AUTOTILE_TABLE` /
 * `WATERFALL_AUTOTILE_TABLE` and `Tilemap.prototype._addAutotile` in RPG
 * Maker MZ's corescript (`rmmz_core.js`) -- values verified against
 * https://github.com/stak/rmmz-corescript. Each table entry is 4 pairs of
 * `[qsx, qsy]` quarter-tile coordinates (0-4 wide, 0-5 tall), one per
 * destination quadrant in row-major order: top-left, top-right, bottom-left,
 * bottom-right.
 */
type QuarterCoord = readonly [number, number];
type AutotileTableEntry = readonly [QuarterCoord, QuarterCoord, QuarterCoord, QuarterCoord];
type AutotileTable = readonly AutotileTableEntry[];

// prettier-ignore
export const FLOOR_AUTOTILE_TABLE: AutotileTable = [
  [
    [2, 4],
    [1, 4],
    [2, 3],
    [1, 3],
  ],
  [
    [2, 0],
    [1, 4],
    [2, 3],
    [1, 3],
  ],
  [
    [2, 4],
    [3, 0],
    [2, 3],
    [1, 3],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 3],
    [1, 3],
  ],
  [
    [2, 4],
    [1, 4],
    [2, 3],
    [3, 1],
  ],
  [
    [2, 0],
    [1, 4],
    [2, 3],
    [3, 1],
  ],
  [
    [2, 4],
    [3, 0],
    [2, 3],
    [3, 1],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 3],
    [3, 1],
  ],
  [
    [2, 4],
    [1, 4],
    [2, 1],
    [1, 3],
  ],
  [
    [2, 0],
    [1, 4],
    [2, 1],
    [1, 3],
  ],
  [
    [2, 4],
    [3, 0],
    [2, 1],
    [1, 3],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 1],
    [1, 3],
  ],
  [
    [2, 4],
    [1, 4],
    [2, 1],
    [3, 1],
  ],
  [
    [2, 0],
    [1, 4],
    [2, 1],
    [3, 1],
  ],
  [
    [2, 4],
    [3, 0],
    [2, 1],
    [3, 1],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
  ],
  [
    [0, 4],
    [1, 4],
    [0, 3],
    [1, 3],
  ],
  [
    [0, 4],
    [3, 0],
    [0, 3],
    [1, 3],
  ],
  [
    [0, 4],
    [1, 4],
    [0, 3],
    [3, 1],
  ],
  [
    [0, 4],
    [3, 0],
    [0, 3],
    [3, 1],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 3],
    [1, 3],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 3],
    [3, 1],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 1],
    [1, 3],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 1],
    [3, 1],
  ],
  [
    [2, 4],
    [3, 4],
    [2, 3],
    [3, 3],
  ],
  [
    [2, 4],
    [3, 4],
    [2, 1],
    [3, 3],
  ],
  [
    [2, 0],
    [3, 4],
    [2, 3],
    [3, 3],
  ],
  [
    [2, 0],
    [3, 4],
    [2, 1],
    [3, 3],
  ],
  [
    [2, 4],
    [1, 4],
    [2, 5],
    [1, 5],
  ],
  [
    [2, 0],
    [1, 4],
    [2, 5],
    [1, 5],
  ],
  [
    [2, 4],
    [3, 0],
    [2, 5],
    [1, 5],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 5],
    [1, 5],
  ],
  [
    [0, 4],
    [3, 4],
    [0, 3],
    [3, 3],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 5],
    [1, 5],
  ],
  [
    [0, 2],
    [1, 2],
    [0, 3],
    [1, 3],
  ],
  [
    [0, 2],
    [1, 2],
    [0, 3],
    [3, 1],
  ],
  [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ],
  [
    [2, 2],
    [3, 2],
    [2, 1],
    [3, 3],
  ],
  [
    [2, 4],
    [3, 4],
    [2, 5],
    [3, 5],
  ],
  [
    [2, 0],
    [3, 4],
    [2, 5],
    [3, 5],
  ],
  [
    [0, 4],
    [1, 4],
    [0, 5],
    [1, 5],
  ],
  [
    [0, 4],
    [3, 0],
    [0, 5],
    [1, 5],
  ],
  [
    [0, 2],
    [3, 2],
    [0, 3],
    [3, 3],
  ],
  [
    [0, 2],
    [1, 2],
    [0, 5],
    [1, 5],
  ],
  [
    [0, 4],
    [3, 4],
    [0, 5],
    [3, 5],
  ],
  [
    [2, 2],
    [3, 2],
    [2, 5],
    [3, 5],
  ],
  [
    [0, 2],
    [3, 2],
    [0, 5],
    [3, 5],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
];

// prettier-ignore
export const WALL_AUTOTILE_TABLE: AutotileTable = [
  [
    [2, 2],
    [1, 2],
    [2, 1],
    [1, 1],
  ],
  [
    [0, 2],
    [1, 2],
    [0, 1],
    [1, 1],
  ],
  [
    [2, 0],
    [1, 0],
    [2, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [2, 2],
    [3, 2],
    [2, 1],
    [3, 1],
  ],
  [
    [0, 2],
    [3, 2],
    [0, 1],
    [3, 1],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
  ],
  [
    [0, 0],
    [3, 0],
    [0, 1],
    [3, 1],
  ],
  [
    [2, 2],
    [1, 2],
    [2, 3],
    [1, 3],
  ],
  [
    [0, 2],
    [1, 2],
    [0, 3],
    [1, 3],
  ],
  [
    [2, 0],
    [1, 0],
    [2, 3],
    [1, 3],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 3],
    [1, 3],
  ],
  [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ],
  [
    [0, 2],
    [3, 2],
    [0, 3],
    [3, 3],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 3],
    [3, 3],
  ],
  [
    [0, 0],
    [3, 0],
    [0, 3],
    [3, 3],
  ],
];

// prettier-ignore
export const WATERFALL_AUTOTILE_TABLE: AutotileTable = [
  [
    [2, 0],
    [1, 0],
    [2, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [3, 0],
    [0, 1],
    [1, 1],
  ],
];

/** One of the 4 sheets whose map tile ids encode an autotile shape. */
export type AutotileSheetId = 'A1' | 'A2' | 'A3' | 'A4';

/** Pixel offset (top-left corner) of one 24x24 quarter-tile within its sheet image. */
export interface QuarterOrigin {
  readonly x: number;
  readonly y: number;
}

/** Destination-quadrant order every 4-quarter result follows: image-space row-major. */
export type QuarterOrigins = readonly [QuarterOrigin, QuarterOrigin, QuarterOrigin, QuarterOrigin];

const QUARTER_SIZE_PX = TILE_SIZE_PX / 2;

interface AutotileAddress {
  readonly bx: number;
  readonly by: number;
  readonly table: AutotileTable;
}

/**
 * A1's sheet packs animated water surface frames alongside waterfalls; `bx`
 * addresses the correct frame column. This slice always renders frame 0 (see
 * `computeAutotileQuarterOrigins`'s `animationFrame` default) -- animating
 * water is deferred, matching corescript's `this.animationFrame % 4` cycle
 * which we pin to 0.
 */
function resolveA1(kind: number, animationFrame: number): AutotileAddress {
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  const waterSurfaceIndex = [0, 1, 2, 1][animationFrame % 4] ?? 0;

  if (kind === 0) return { bx: waterSurfaceIndex * 2, by: 0, table: FLOOR_AUTOTILE_TABLE };
  if (kind === 1) return { bx: waterSurfaceIndex * 2, by: 3, table: FLOOR_AUTOTILE_TABLE };
  if (kind === 2) return { bx: 6, by: 0, table: FLOOR_AUTOTILE_TABLE };
  if (kind === 3) return { bx: 6, by: 3, table: FLOOR_AUTOTILE_TABLE };

  let bx = Math.floor(tx / 4) * 8;
  let by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
  let table: AutotileTable = FLOOR_AUTOTILE_TABLE;
  if (kind % 2 === 0) {
    bx += waterSurfaceIndex * 2;
  } else {
    bx += 6;
    table = WATERFALL_AUTOTILE_TABLE;
    by += animationFrame % 3;
  }
  return { bx, by, table };
}

// A2 kinds start at global kind row 2: (TILE_ID_A2 - TILE_ID_A1) / 48 / 8 =
// (2816 - 2048) / 384 = 2. Each A2 block is 2x3 tiles, hence `* 3` rows.
function resolveA2(kind: number): AutotileAddress {
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  return { bx: tx * 2, by: (ty - 2) * 3, table: FLOOR_AUTOTILE_TABLE };
}

// A3 kinds start at global kind row 6: (TILE_ID_A3 - TILE_ID_A1) / 48 / 8 =
// (4352 - 2048) / 384 = 6. Each A3 block is 2x2 tiles, hence `* 2` rows.
function resolveA3(kind: number): AutotileAddress {
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  return { bx: tx * 2, by: (ty - 6) * 2, table: WALL_AUTOTILE_TABLE };
}

/**
 * A4 kinds start at global kind row 10: (TILE_ID_A4 - TILE_ID_A1) / 48 / 8 =
 * (5888 - 2048) / 384 = 10. Rows alternate: even `ty` is a floor-style block
 * (2x3 tiles), odd `ty` a wall-style block (2x2) — hence the 2.5-row stride.
 */
function resolveA4(kind: number): AutotileAddress {
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  const by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
  const table = ty % 2 === 1 ? WALL_AUTOTILE_TABLE : FLOOR_AUTOTILE_TABLE;
  return { bx: tx * 2, by, table };
}

function resolveAddress(
  sheet: AutotileSheetId,
  kind: number,
  animationFrame: number,
): AutotileAddress {
  switch (sheet) {
    case 'A1':
      return resolveA1(kind, animationFrame);
    case 'A2':
      return resolveA2(kind);
    case 'A3':
      return resolveA3(kind);
    case 'A4':
      return resolveA4(kind);
  }
}

/**
 * Resolves the 4 source-sheet quarter-tile pixel origins (top-left corner of
 * each 24x24 quarter, in image-space pixels) that compose one autotile map
 * tile id, in destination order [top-left, top-right, bottom-left,
 * bottom-right].
 *
 * `animationFrame` only affects A1 (water/waterfall): this slice always
 * passes/defaults to 0 (the first frame) -- water animation is deferred, see
 * `resolveA1`.
 */
export function computeAutotileQuarterOrigins(
  tileId: number,
  sheet: AutotileSheetId,
  animationFrame = 0,
): QuarterOrigins {
  const kind = getAutotileKind(tileId);
  const shape = getAutotileShape(tileId);
  const { bx, by, table } = resolveAddress(sheet, kind, animationFrame);

  // Defensive only: real map data never emits a shape index beyond the
  // selected table's legal range (e.g. A3/A4 wall shapes are always 0-15),
  // but malformed/corrupt tile ids should not crash the renderer -- corescript
  // itself has no such guard and would read `undefined` here.
  const entry = table[shape % table.length] as AutotileTableEntry;

  return entry.map(([qsx, qsy]) => ({
    x: (bx * 2 + qsx) * QUARTER_SIZE_PX,
    y: (by * 2 + qsy) * QUARTER_SIZE_PX,
  })) as unknown as QuarterOrigins;
}
