import type { TileSheetId } from '@threemaker/importer-rpgm';

/** Which of a tile's 4 edges, in map space (north = toward smaller tileY / image-top). */
export type EdgeDirection = 'north' | 'south' | 'east' | 'west';

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
 * culling (occupied = other wall tiles in the same chunk) and could serve
 * any other adjacency-driven face culling.
 *
 * ponytail: `occupiedKeys` is chunk-local by every current caller, so a wall
 * tile at a chunk's edge always reports an open face toward the next chunk
 * even when a wall tile actually continues there -- an acceptable seam this
 * slice (see build-chunk-group.ts).
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
