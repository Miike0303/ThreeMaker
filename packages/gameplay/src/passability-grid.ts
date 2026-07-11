import type { EdgeDirection, RpgmMap, RpgmTileset, TileFlags } from '@threemaker/importer-rpgm';
import { decodeTileFlags, profilesEqual } from '@threemaker/importer-rpgm';
import { ElevationField } from './elevation-field.js';
import type { Direction } from './grid-mover.js';
import { DIRECTION_DELTA } from './grid-mover.js';

const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

/** Movement direction -> the map-space edge a step crosses (`down`/`up` vary in y = south/north; `left`/`right` vary in x = west/east). */
const DIRECTION_EDGE: Record<Direction, EdgeDirection> = {
  down: 'south',
  up: 'north',
  left: 'west',
  right: 'east',
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
 * ponytail: elevation (region-derived, see `elevation` below) blocks a step
 * whenever the shared edge's height profiles disagree between the two
 * tiles (design doc "Ramps y Escaleras": edge height profile) -- a ramp
 * cell's downhill/uphill edges match its lower/higher flat neighbors
 * exactly, opening that one authorized crossing, while every other
 * cross-height edge (and any same-height-but-mismatched-slope edge, e.g. a
 * flat cell against a ramp's perpendicular side) still blocks, matching the
 * pre-ramp cliff-invariant behavior byte-for-byte on maps with no ramps.
 */
export class PassabilityGrid {
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  // One decisive TileFlags per map tile, or `null` when no non-star,
  // non-empty tile was found on any layer (treated as fully open).
  private readonly decisiveFlags: (TileFlags | null)[];
  // Region-derived elevation + ramp slope data (MV3D height convention +
  // "edge height profile" ramps, see `ElevationField`). Shared with the app
  // layer's height sampling when a caller passes one in (see constructor);
  // built with no ramp cells (all-zero rampGrid) when omitted, which
  // degenerates every edge-profile check to a plain height comparison.
  private readonly elevation: ElevationField;

  /**
   * `elevation`, when given, lets a caller share ONE `ElevationField`
   * between this grid's `canMove` and the app layer's height sampling (see
   * design's data-flow: both consumers must read the identical
   * `heightGrid`/`rampGrid` so they can never disagree about a ramp's
   * surface). Omitted builds a fresh `ElevationField` from `map` with no
   * ramp cells resolved -- every existing caller that doesn't pass ramp
   * semantics yet gets exactly today's height-only behavior.
   */
  constructor(map: RpgmMap, tileset: RpgmTileset, elevation?: ElevationField) {
    this.mapWidth = map.width;
    this.mapHeight = map.height;
    this.decisiveFlags = new Array(this.mapWidth * this.mapHeight);
    this.elevation = elevation ?? new ElevationField(map);

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
    return this.elevation.heightAt(x, y);
  }

  /**
   * Whether a mover standing on `(x, y)` can step toward `direction`.
   * Blocked when the destination is out of bounds, when the shared edge's
   * height profiles disagree from either side (the edge-profile rule: see
   * class doc -- this is what opens an authorized ramp crossing in both
   * directions while still blocking every other cross-height step, and also
   * blocks a same-height step onto a ramp's mid-slope perpendicular edge
   * from a flat neighbor), when `(x, y)`'s decisive flags forbid leaving in
   * `direction`, or when the destination tile's decisive flags forbid
   * entering from the opposite side.
   */
  canMove(x: number, y: number, direction: Direction): boolean {
    if (!this.inBounds(x, y)) return false;

    const delta = DIRECTION_DELTA[direction];
    const destX = x + delta.x;
    const destY = y + delta.y;
    if (!this.inBounds(destX, destY)) return false;

    const sourceEdge = this.elevation.edgeProfileAt(x, y, DIRECTION_EDGE[direction]);
    const destEdge = this.elevation.edgeProfileAt(
      destX,
      destY,
      DIRECTION_EDGE[OPPOSITE[direction]],
    );
    if (!profilesEqual(sourceEdge, destEdge)) return false;

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
