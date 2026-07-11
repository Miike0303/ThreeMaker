import type { RpgmMap, RpgmTileset, TileFlags } from '@threemaker/importer-rpgm';
import { computeHeightGrid, decodeTileFlags } from '@threemaker/importer-rpgm';
import type { Direction } from './grid-mover.js';
import { DIRECTION_DELTA } from './grid-mover.js';

const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

function isBlockedDirection(flags: TileFlags, direction: Direction): boolean {
  switch (direction) {
    case 'down':
      return flags.impassableDown;
    case 'left':
      return flags.impassableLeft;
    case 'right':
      return flags.impassableRight;
    case 'up':
      return flags.impassableUp;
  }
}

/**
 * Tile passability derived from an `RpgmMap`'s 4 tile layers and its
 * matching `RpgmTileset`'s per-tile flags: for each tile, the 4 layers are
 * read top-down (layer 3 to layer 0) and the first non-star, non-empty tile
 * "decides" -- its directional bits determine whether the tile can be left
 * or entered in each direction. This is a simplified subset of RPG Maker
 * MV/MZ's own passage rules:
 *
 * ponytail: vehicles (boat/ship/airship) have their own passability rules
 * layered on top of the terrain in real RPG Maker; not modeled here,
 * everything is checked as "on foot".
 * ponytail: the ladder/bush/counter/damage-floor flags (available via
 * `decodeTileFlags` but unused here) affect rendering/behavior, not raw
 * terrain passability, and are out of scope for this slice.
 * ponytail: other characters/events occupying a tile (RPG Maker's
 * "through"/character collision) are not modeled; this is terrain-only.
 * ponytail: elevation (region-derived, see `heightGrid` below) only ever
 * blocks a step outright when the two tiles' heights differ -- there is no
 * ramp/stairs support yet, so the only way up or down a terrace is a future
 * feature, not this slice.
 */
export class PassabilityGrid {
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  // One decisive TileFlags per map tile, or `null` when no non-star,
  // non-empty tile was found on any layer (treated as fully open).
  private readonly decisiveFlags: (TileFlags | null)[];
  // Region-derived elevation per tile (MV3D convention: region 1-7 = that
  // many tile-heights up). A step is blocked whenever source and destination
  // heights differ, ramps/stairs aside (see class doc).
  private readonly heightGrid: Uint8Array;

  constructor(map: RpgmMap, tileset: RpgmTileset) {
    this.mapWidth = map.width;
    this.mapHeight = map.height;
    this.decisiveFlags = new Array(this.mapWidth * this.mapHeight);
    this.heightGrid = computeHeightGrid(map);

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        this.decisiveFlags[y * this.mapWidth + x] = computeDecisiveFlags(map, tileset, x, y);
      }
    }
  }

  get width(): number {
    return this.mapWidth;
  }

  get height(): number {
    return this.mapHeight;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.mapWidth && y < this.mapHeight;
  }

  /** Region-derived elevation (in tile-height units) at `(x, y)`; 0 for an out-of-bounds query. */
  elevationAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.heightGrid[y * this.mapWidth + x] ?? 0;
  }

  /**
   * Whether a mover standing on `(x, y)` can step toward `direction`.
   * Blocked when the destination is out of bounds, when source and
   * destination sit at different elevations (no ramps/stairs yet -- see
   * class doc), when `(x, y)`'s decisive flags forbid leaving in
   * `direction`, or when the destination tile's decisive flags forbid
   * entering from the opposite side.
   */
  canMove(x: number, y: number, direction: Direction): boolean {
    if (!this.inBounds(x, y)) return false;

    const delta = DIRECTION_DELTA[direction];
    const destX = x + delta.x;
    const destY = y + delta.y;
    if (!this.inBounds(destX, destY)) return false;

    const sourceHeight = this.heightGrid[y * this.mapWidth + x] ?? 0;
    const destHeight = this.heightGrid[destY * this.mapWidth + destX] ?? 0;
    if (sourceHeight !== destHeight) return false;

    const sourceFlags = this.decisiveFlags[y * this.mapWidth + x];
    if (sourceFlags && isBlockedDirection(sourceFlags, direction)) return false;

    const destFlags = this.decisiveFlags[destY * this.mapWidth + destX];
    if (destFlags && isBlockedDirection(destFlags, OPPOSITE[direction])) return false;

    return true;
  }

  /**
   * Whether `(x, y)` is a reasonable spot to stand/spawn on: in bounds and
   * not sealed off from every direction at once. A tile only partially
   * blocked (e.g. a one-way ledge) still counts as standable -- this only
   * picks a spot to be on, it does not validate a specific step (use
   * `canMove` for that).
   */
  isStandable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const flags = this.decisiveFlags[y * this.mapWidth + x];
    if (!flags) return true;
    return !(
      flags.impassableDown &&
      flags.impassableLeft &&
      flags.impassableRight &&
      flags.impassableUp
    );
  }
}

function computeDecisiveFlags(
  map: RpgmMap,
  tileset: RpgmTileset,
  x: number,
  y: number,
): TileFlags | null {
  const index = y * map.width + x;
  // Layers 3 (top) down to 0 (bottom): the first non-star, non-empty tile decides.
  for (let layerIndex = 3; layerIndex >= 0; layerIndex--) {
    const layer = map.layers.tileLayers[layerIndex];
    const tileId = layer?.[index] ?? 0;
    if (tileId === 0) continue;

    const flags = decodeTileFlags(tileset.flags[tileId] ?? 0);
    if (flags.isUpperLayer) continue; // star bit: never decides, keep looking below

    return flags;
  }
  return null; // no decisive tile found on any layer: treated as open
}
