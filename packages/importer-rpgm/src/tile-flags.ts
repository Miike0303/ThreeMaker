/**
 * Decoding for the per-tile `flags` bitfield in `Tilesets.json` (one entry
 * per tile ID, 0-8191). Bit layout per RPG Maker MV/MZ corescript
 * (`Tilemap`/`Game_Map` passage checks):
 *
 * - `0x1`-`0x8`: passage blocked from the down/left/right/up side.
 * - `0x10`: the "star" bit — render this tile on the upper layer (used by
 *   the future renderer to decide which tiles get extruded above the
 *   ground plane for the 2.5D look).
 * - `0x20`/`0x40`/`0x80`/`0x100`: ladder / bush / counter / damage floor.
 * - bits 12-15: terrain tag (0-15), a free-form region-like id used by
 *   events/plugins (e.g. footstep sound sets).
 */
export interface TileFlags {
  readonly impassableDown: boolean;
  readonly impassableLeft: boolean;
  readonly impassableRight: boolean;
  readonly impassableUp: boolean;
  readonly isUpperLayer: boolean;
  readonly isLadder: boolean;
  readonly isBush: boolean;
  readonly isCounter: boolean;
  readonly isDamageFloor: boolean;
  readonly terrainTag: number;
}

const FLAG_IMPASSABLE_DOWN = 0x1;
const FLAG_IMPASSABLE_LEFT = 0x2;
const FLAG_IMPASSABLE_RIGHT = 0x4;
const FLAG_IMPASSABLE_UP = 0x8;
const FLAG_UPPER_LAYER = 0x10;
const FLAG_LADDER = 0x20;
const FLAG_BUSH = 0x40;
const FLAG_COUNTER = 0x80;
const FLAG_DAMAGE_FLOOR = 0x100;
const TERRAIN_TAG_SHIFT = 12;
const TERRAIN_TAG_MASK = 0xf;

export function decodeTileFlags(flags: number): TileFlags {
  return {
    impassableDown: (flags & FLAG_IMPASSABLE_DOWN) !== 0,
    impassableLeft: (flags & FLAG_IMPASSABLE_LEFT) !== 0,
    impassableRight: (flags & FLAG_IMPASSABLE_RIGHT) !== 0,
    impassableUp: (flags & FLAG_IMPASSABLE_UP) !== 0,
    isUpperLayer: (flags & FLAG_UPPER_LAYER) !== 0,
    isLadder: (flags & FLAG_LADDER) !== 0,
    isBush: (flags & FLAG_BUSH) !== 0,
    isCounter: (flags & FLAG_COUNTER) !== 0,
    isDamageFloor: (flags & FLAG_DAMAGE_FLOOR) !== 0,
    terrainTag: (flags >> TERRAIN_TAG_SHIFT) & TERRAIN_TAG_MASK,
  };
}
