import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { TileBuildData } from './types.js';

/** Which of a tile's 4 edges, in map space (north = toward smaller tileY / image-top). */
export type EdgeDirection = 'north' | 'south' | 'east' | 'west';

/**
 * A ramp cell's downhill direction. Same 4-value union as `EdgeDirection`
 * (duplicated on purpose, not imported, from `@threemaker/importer-rpgm`'s
 * own `RampDirection` -- mirrors this file's existing `EdgeDirection`
 * duplication, a pattern already approved for this feature in Slice 1's
 * design notes: renderer/gameplay each keep their own copy of shared literal
 * unions rather than depending on importer-rpgm's types for them).
 */
export type RampDirection = EdgeDirection;

export const EDGE_DIRECTIONS: readonly EdgeDirection[] = ['north', 'south', 'east', 'west'];

/** Tile-coordinate delta toward the neighbor across each edge. */
export const EDGE_DELTA: Record<EdgeDirection, { readonly dx: number; readonly dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
  east: { dx: 1, dy: 0 },
};

/** The 2 sheets whose autotile ids are wall autotiles (per `getTileSheet`); everything else is floor/decor. */
const WALL_SHEETS: ReadonlySet<TileSheetId> = new Set(['A3', 'A4']);

/** Whether a tile's sheet is one of RPG Maker's wall autotile sheets (A3/A4). */
export function isWallSheet(sheet: TileSheetId): boolean {
  return WALL_SHEETS.has(sheet);
}

/** Stable string key for a tile coordinate, for `Set`/`Map` membership checks. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export { computeHeightGrid, heightForRegion } from '@threemaker/importer-rpgm';

export interface CliffEdgeData {
  readonly edge: EdgeDirection;
  /** The neighbor's height (tile-height units); the cliff face spans from this height up to the tile's own. */
  readonly neighborHeight: number;
}

/**
 * Which edges of tile `(x, y)` need a cliff face -- i.e. edges whose
 * neighbor sits at a lower elevation than `(x, y)` itself -- and how far
 * down each one goes. A tile at ground level (height 0) never needs a
 * cliff face (there is nothing below the ground plane to expose). An
 * off-map neighbor is treated as ground level (height 0): an elevated tile
 * at the map's edge gets a cliff facing the void, matching how MV3D itself
 * treats the map boundary.
 */
export function computeCliffEdges(
  heightGrid: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
): readonly CliffEdgeData[] {
  const ownHeight = heightGrid[y * mapWidth + x] ?? 0;
  if (ownHeight === 0) return [];

  const edges: CliffEdgeData[] = [];
  for (const edge of EDGE_DIRECTIONS) {
    const delta = EDGE_DELTA[edge];
    const nx = x + delta.dx;
    const ny = y + delta.dy;
    const inBounds = nx >= 0 && ny >= 0 && nx < mapWidth && ny < mapHeight;
    const neighborHeight = inBounds ? (heightGrid[ny * mapWidth + nx] ?? 0) : 0;
    if (neighborHeight < ownHeight) edges.push({ edge, neighborHeight });
  }
  return edges;
}

/**
 * Which of tile `(x, y)`'s 4 edges have no same-set neighbor -- i.e. should
 * draw a face because nothing occupies the adjacent cell in `occupiedKeys`.
 * Generic over what "occupied" means: used both for wall-prism side-face
 * culling (occupied = other wall tiles) and could serve any other
 * adjacency-driven face culling.
 *
 * `occupiedKeys` must cover the full extent a caller cares about checking
 * neighbors against -- for wall-prism culling that means the whole map (see
 * `computeWallTileKeys`), not just one chunk, or a wall tile at a chunk's
 * edge would wrongly report an open face toward a wall tile that actually
 * continues in the next chunk (see `build-chunk-group.ts`).
 */
export function computeOpenEdges(
  occupiedKeys: ReadonlySet<string>,
  x: number,
  y: number,
): readonly EdgeDirection[] {
  const edges: EdgeDirection[] = [];
  for (const edge of EDGE_DIRECTIONS) {
    const delta = EDGE_DELTA[edge];
    if (!occupiedKeys.has(tileKey(x + delta.dx, y + delta.dy))) edges.push(edge);
  }
  return edges;
}

/** `computeRampGrid`'s (importer-rpgm) cell encoding: 0 = none, 1-4 = N/S/E/W downhill direction -- duplicated here (not imported) for the same reason as `RampDirection` above; kept in exact sync with importer-rpgm's own `RAMP_DIRECTION_BY_CODE`. */
const RAMP_DIRECTION_BY_CODE: readonly (RampDirection | undefined)[] = [
  undefined,
  'north',
  'south',
  'east',
  'west',
];

/** A ramp tile's slope descriptor: which way it faces downhill, and the two heights (tile-height units) its edges span. Ramps are always exactly 1 level tall (`lowHeight === highHeight - 1`) -- see `computeRampGrid`'s multi-level-span-is-inert rule. */
export interface RampData {
  readonly direction: RampDirection;
  /** This cell's own height -- the ramp's uphill edge (matches `TileBuildData.height` when present). */
  readonly highHeight: number;
  /** The ramp's downhill edge height, always `highHeight - 1`. */
  readonly lowHeight: number;
}

/**
 * Resolves one map cell's `rampGrid` code into the `RampData` descriptor
 * `TileBuildData.ramp` carries, so `build-chunk-group.ts` can build the
 * inclined quad and skirt faces from `direction`/`highHeight`/`lowHeight`
 * alone -- without needing the whole-map height/ramp grids itself (a ramp
 * cell's own corner heights are purely a function of its own height + own
 * direction, see importer-rpgm's `elevation.ts` module doc). Returns
 * `undefined` for a non-ramp cell (code 0).
 */
export function rampDataAt(code: number, ownHeight: number): RampData | undefined {
  const direction = RAMP_DIRECTION_BY_CODE[code];
  return direction === undefined
    ? undefined
    : { direction, highHeight: ownHeight, lowHeight: ownHeight - 1 };
}

/**
 * The set of `tileKey`s for every ground-elevation wall-autotile (A3/A4)
 * tile among `tiles` -- the "occupied" set `computeOpenEdges` needs for
 * wall-prism interior-face culling. Building this from `tiles` spanning the
 * *whole map* (every chunk's tiles, not just one chunk's) is what lets two
 * wall prisms on either side of a chunk border correctly suppress the
 * interior face between them -- see `build-chunk-group.ts`.
 */
export function computeWallTileKeys(
  tiles: readonly Pick<TileBuildData, 'tileX' | 'tileY' | 'sheet' | 'elevation'>[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const tile of tiles) {
    if (tile.elevation !== 'upper' && isWallSheet(tile.sheet)) {
      keys.add(tileKey(tile.tileX, tile.tileY));
    }
  }
  return keys;
}
