import type { RpgmMap } from './types.js';

/**
 * MV3D community convention: a tile's region id (1-7) sets its floor
 * elevation, in tile-height units -- region N means "this tile's floor sits
 * N tile-heights above the default y=0 plane". Region 0 (unpainted) and any
 * id outside 1-7 (regions 8-255 are free-form, used by other plugins/events
 * for unrelated purposes such as encounter zones) are ground level.
 */
export const MAX_REGION_HEIGHT = 7;

/** Elevation (in tile-height units) a region id encodes, per the MV3D convention. */
export function heightForRegion(region: number): number {
  return region >= 1 && region <= MAX_REGION_HEIGHT ? region : 0;
}

/**
 * Per-tile elevation grid for a whole map, in tile-height units, row-major
 * (`width * height` entries, same indexing as `RpgmMapLayers`'s layers).
 * Pure function of the map's region layer -- cheap enough to recompute
 * whenever a map loads, no caching needed.
 */
export function computeHeightGrid(map: RpgmMap): Uint8Array {
  const size = map.width * map.height;
  const grid = new Uint8Array(size);
  const regions = map.layers.regions;
  for (let i = 0; i < size; i++) {
    grid[i] = heightForRegion(regions[i] ?? 0);
  }
  return grid;
}

/*
 * -------------------------------------------------------------------------
 * Design doc "Ramps y Escaleras" (section: "edge height profile") -- pure
 * primitives.
 *
 * Single source of truth so gameplay (`ElevationField`/`PassabilityGrid`,
 * added in a later slice) and the renderer (`buildChunks`, added in a later
 * slice) cannot diverge. This slice only adds the pure primitives below --
 * no consumer wiring, no schema version bump, no rendering/gameplay change.
 *
 * A flat cell's 4 edges are all at its own height H. A ramp cell (height H,
 * downhill direction `d`) has: the `d` edge at H-1, the opposite edge at H,
 * and the two perpendicular edges sloping linearly between H and H-1. This
 * is purely a function of the cell's OWN height + own ramp direction --
 * looking up a neighbor is never required to compute a cell's own edge
 * profile (see `edgeProfileAt`), which is what lets a shared edge compare
 * cleanly from either adjacent cell's perspective (see `EdgeProfile`).
 * -------------------------------------------------------------------------
 */

/** Which of a tile's 4 edges, in map space (north = toward smaller y / image-top). */
export type EdgeDirection = 'north' | 'south' | 'east' | 'west';

/** A ramp cell's downhill direction -- the edge that sits one height level below the cell's own height. */
export type RampDirection = 'north' | 'south' | 'east' | 'west';

const EDGE_DIRECTIONS: readonly EdgeDirection[] = ['north', 'south', 'east', 'west'];

/** Tile-coordinate delta toward the neighbor across each direction (shared shape for `EdgeDirection`/`RampDirection`). */
const DIRECTION_DELTA: Record<EdgeDirection, { readonly dx: number; readonly dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
  east: { dx: 1, dy: 0 },
};

/** Deterministic ambiguity resolution order (design: "Direction derivation"), highest priority first. */
const TIE_BREAK_ORDER: readonly RampDirection[] = ['south', 'east', 'west', 'north'];

/**
 * Map-wide read-only context shared by every height primitive in this
 * module: this map's per-cell height grid and its dimensions. Passing this
 * as one named object -- instead of separate `heightGrid`/`mapWidth`/
 * `mapHeight` positional args, which previously appeared in inconsistent
 * per-function order -- removes the risk of a call site silently
 * transposing same-typed scalars (a swapped `mapWidth`/`mapHeight`, or
 * `heightGrid`/`rampGrid`, compiles cleanly since both sides of each swap
 * share a type).
 */
export interface HeightGridContext {
  readonly heightGrid: Uint8Array;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

/**
 * `HeightGridContext` plus the derived `rampGrid` (see `computeRampGrid`).
 * `edgeProfileAt`/`surfaceHeightAt` need both grids to read a cell's slope;
 * `computeRampGrid` produces `rampGrid` in the first place, so it only takes
 * `HeightGridContext`.
 */
export interface GridContext extends HeightGridContext {
  readonly rampGrid: Uint8Array;
}

/** True iff `(x,y)` is within `[0,mapWidth) x [0,mapHeight)`. Shared by every off-map/off-grid check in this module. */
function isInBounds(x: number, y: number, mapWidth: number, mapHeight: number): boolean {
  return x >= 0 && y >= 0 && x < mapWidth && y < mapHeight;
}

/** `rampGrid` cell encoding: 0 = no ramp, 1-4 = downhill direction (design: "rampGrid: 0 = none, 1-4 encode N/S/E/W"). */
const RAMP_DIRECTION_CODE: Record<RampDirection, number> = { north: 1, south: 2, east: 3, west: 4 };

/**
 * `rampGrid` cell encoding table: index 0 = no ramp, 1-4 = downhill
 * direction N/S/E/W (design: "rampGrid: 0 = none, 1-4 encode N/S/E/W").
 * Exported so any consumer needing the same decode table -- e.g. the
 * renderer, which resolves a cell's `RampData` from a raw `rampGrid` code in
 * `packages/renderer/src/geometry/elevation.ts` -- imports this canonical
 * array instead of maintaining its own duplicate kept in sync by comment
 * only.
 */
export const RAMP_DIRECTION_BY_CODE: readonly (RampDirection | undefined)[] = [
  undefined,
  'north',
  'south',
  'east',
  'west',
];

function decodeRampDirection(code: number): RampDirection | undefined {
  return RAMP_DIRECTION_BY_CODE[code];
}

/**
 * Surface heights (tile-height units) at the two corners bounding one cell
 * edge, ALWAYS ordered by ascending global corner coordinate (x primary, y
 * secondary). A cell (x,y) has corners on the integer corner-grid at
 * (x,y),(x+1,y),(x,y+1),(x+1,y+1). Because a shared edge maps to the SAME
 * two global corners from either adjacent cell, this canonical ordering
 * makes an edge directly comparable from both perspectives -- no
 * direction-flip bookkeeping at the call site.
 *   [0] = corner with smaller (x,y); [1] = corner with larger (x,y).
 */
export type EdgeProfile = readonly [number, number];

/**
 * The 2 global corners bounding `(x,y)`'s `edge`, already in canonical
 * ascending order: north/south edges vary in x (x < x+1, same y); west/east
 * edges vary in y (y < y+1, same x) -- so the construction order below IS
 * the canonical order, no extra sort needed.
 */
function edgeCorners(
  x: number,
  y: number,
  edge: EdgeDirection,
): readonly [readonly [number, number], readonly [number, number]] {
  switch (edge) {
    case 'north':
      return [
        [x, y],
        [x + 1, y],
      ];
    case 'south':
      return [
        [x, y + 1],
        [x + 1, y + 1],
      ];
    case 'west':
      return [
        [x, y],
        [x, y + 1],
      ];
    case 'east':
      return [
        [x + 1, y],
        [x + 1, y + 1],
      ];
  }
}

/**
 * The surface height at one of cell `(cellX,cellY)`'s 4 corners, given the
 * cell's own height and (optional) ramp direction. Flat cells (`rampDir`
 * undefined) put every corner at `ownHeight`. A ramp cell's downhill edge
 * corners sit at `ownHeight - 1`; every other corner sits at `ownHeight` --
 * which makes the two perpendicular edges each pick up one corner from each
 * group, i.e. the linear H..H-1 slope (see module doc).
 */
function cornerHeight(
  cornerX: number,
  cornerY: number,
  cellX: number,
  cellY: number,
  ownHeight: number,
  rampDir: RampDirection | undefined,
): number {
  if (rampDir === undefined) return ownHeight;

  let isDownhillCorner: boolean;
  switch (rampDir) {
    case 'north':
      isDownhillCorner = cornerY === cellY;
      break;
    case 'south':
      isDownhillCorner = cornerY === cellY + 1;
      break;
    case 'west':
      isDownhillCorner = cornerX === cellX;
      break;
    case 'east':
      isDownhillCorner = cornerX === cellX + 1;
      break;
  }

  return isDownhillCorner ? ownHeight - 1 : ownHeight;
}

/**
 * The two corner surface heights of tile `(x,y)`'s `edge`, in `EdgeProfile`
 * canonical order. Flat cells return `[H,H]`; ramp cells reflect the slope.
 * Off-map `(x,y)` -> ground (`[0,0]`), matching `computeCliffEdges`'s
 * existing off-map-is-ground-level convention.
 */
export function edgeProfileAt(
  ctx: GridContext,
  x: number,
  y: number,
  edge: EdgeDirection,
): EdgeProfile {
  const { heightGrid, rampGrid, mapWidth, mapHeight } = ctx;
  if (!isInBounds(x, y, mapWidth, mapHeight)) return [0, 0];

  const index = y * mapWidth + x;
  const ownHeight = heightGrid[index] ?? 0;
  const rampDir = decodeRampDirection(rampGrid[index] ?? 0);

  const [c0, c1] = edgeCorners(x, y, edge);
  return [
    cornerHeight(c0[0], c0[1], x, y, ownHeight, rampDir),
    cornerHeight(c1[0], c1[1], x, y, ownHeight, rampDir),
  ];
}

/**
 * True iff both corner heights match -- the passability + coplanarity test.
 * A step across a shared edge is exactly allowed when the two adjacent
 * cells' `edgeProfileAt(...)` results (computed from either side) are equal.
 */
export function profilesEqual(a: EdgeProfile, b: EdgeProfile): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Interpolated surface height (tile-height units) at fractional cell
 * position `(fx,fy)`: flat cells return a constant height regardless of
 * position; ramp cells return the exact slope plane (bilinear interpolation
 * of the cell's 4 corner heights degenerates to a pure 1-D linear ramp
 * because two of the four corners always share the same height -- see
 * module doc). Used for mover/camera Y sampling.
 *
 * `(fx,fy)` outside `[0,mapWidth]x[0,mapHeight]` is clamped to the nearest
 * in-map cell rather than treated as ground -- callers are expected to only
 * sample positions a mover/camera can actually occupy.
 */
export function surfaceHeightAt(ctx: GridContext, fx: number, fy: number): number {
  const { heightGrid, rampGrid, mapWidth, mapHeight } = ctx;
  const cellX = Math.min(Math.max(Math.floor(fx), 0), mapWidth - 1);
  const cellY = Math.min(Math.max(Math.floor(fy), 0), mapHeight - 1);
  const u = clamp01(fx - cellX);
  const v = clamp01(fy - cellY);

  const index = cellY * mapWidth + cellX;
  const ownHeight = heightGrid[index] ?? 0;
  const rampDir = decodeRampDirection(rampGrid[index] ?? 0);

  const topLeft = cornerHeight(cellX, cellY, cellX, cellY, ownHeight, rampDir);
  const topRight = cornerHeight(cellX + 1, cellY, cellX, cellY, ownHeight, rampDir);
  const bottomLeft = cornerHeight(cellX, cellY + 1, cellX, cellY, ownHeight, rampDir);
  const bottomRight = cornerHeight(cellX + 1, cellY + 1, cellX, cellY, ownHeight, rampDir);

  const top = topLeft * (1 - u) + topRight * u;
  const bottom = bottomLeft * (1 - u) + bottomRight * u;
  return top * (1 - v) + bottom * v;
}

/**
 * Logs `message` via `console.warn` when available, without declaring an
 * ambient global `console` (this package's `global.d.ts` deliberately keeps
 * only the exact Node builtins `loadProject` needs, and other packages in
 * this repo already declare a differently-shaped ambient `console` -- a
 * second, conflicting global declaration here would break their builds).
 * `console` is a real global in every runtime this module ships to (Node
 * and every browser), so reading it off `globalThis` with a narrow local
 * type is safe and side-effect-free when absent.
 */
function devWarn(message: string): void {
  (globalThis as { console?: { warn?: (message: string) => void } }).console?.warn?.(message);
}

/**
 * One map cell classified `'ramp'` by tileset semantics, resolved by the
 * caller. This module intentionally has no dependency on
 * `@threemaker/map-format` (that package isn't a dependency of
 * `@threemaker/importer-rpgm`, keeping the existing one-directional
 * layering: gameplay/renderer -> importer-rpgm) -- so callers resolve which
 * cells are ramp-classed (map-format's `SemanticOverrides`, keyed by tile
 * id) and pass the resulting per-cell list here.
 */
export interface RampCellInput {
  readonly x: number;
  readonly y: number;
  /** Author-provided `TileSemanticEntry.rampDirection` override for this cell, if any. */
  readonly rampDirection?: RampDirection;
}

/**
 * Derives each ramp cell's downhill direction from `heightGrid` (design:
 * "Direction derivation"). Precedence:
 *  1. A `rampDirection` override is used outright when VALID, i.e. the
 *     neighbor in that direction sits exactly one height level below the
 *     cell -- regardless of what the auto-derived candidate would have
 *     been.
 *  2. Otherwise, candidates = in-bounds 4-neighbors at exactly `H-1`. A
 *     single candidate is used directly.
 *  3. 2+ candidates (ambiguous) resolve via the deterministic tie-break
 *     `south > east > west > north`.
 *  4. No candidate at all: the cell is inert (rendered flat / non-ramp). If
 *     this happened because the cell's only lower neighbor (or its invalid
 *     override) is MORE than one height level away, a dev warning is
 *     logged -- per spec this is a soft, non-fatal condition, never a hard
 *     rejection.
 *
 * Pure function of `heightGrid` + the resolved ramp-cell list; off-map
 * neighbors count as ground (height 0), matching `computeCliffEdges`.
 */
export function computeRampGrid(
  ctx: HeightGridContext,
  rampCells: readonly RampCellInput[],
): Uint8Array {
  const { heightGrid, mapWidth, mapHeight } = ctx;
  const grid = new Uint8Array(mapWidth * mapHeight);

  const neighborHeight = (x: number, y: number, direction: RampDirection): number => {
    const delta = DIRECTION_DELTA[direction];
    const nx = x + delta.dx;
    const ny = y + delta.dy;
    return isInBounds(nx, ny, mapWidth, mapHeight) ? (heightGrid[ny * mapWidth + nx] ?? 0) : 0;
  };

  for (const cell of rampCells) {
    const { x, y, rampDirection } = cell;
    const ownHeight = heightGrid[y * mapWidth + x] ?? 0;

    if (rampDirection !== undefined && ownHeight - neighborHeight(x, y, rampDirection) === 1) {
      grid[y * mapWidth + x] = RAMP_DIRECTION_CODE[rampDirection];
      continue;
    }

    const candidates = EDGE_DIRECTIONS.filter(
      (direction) => ownHeight - neighborHeight(x, y, direction) === 1,
    );

    let resolved: RampDirection | undefined;
    if (candidates.length === 1) {
      resolved = candidates[0];
    } else if (candidates.length > 1) {
      resolved = TIE_BREAK_ORDER.find((direction) => candidates.includes(direction));
    }

    if (resolved !== undefined) {
      grid[y * mapWidth + x] = RAMP_DIRECTION_CODE[resolved];
      continue;
    }

    const spansMultipleLevels =
      (rampDirection !== undefined &&
        Math.abs(ownHeight - neighborHeight(x, y, rampDirection)) > 1) ||
      EDGE_DIRECTIONS.some((direction) => ownHeight - neighborHeight(x, y, direction) > 1);
    if (spansMultipleLevels) {
      devWarn(
        `computeRampGrid: ramp cell (${x}, ${y}) at height ${ownHeight} has no neighbor exactly one height level below it (multi-level span); treating the cell as inert (non-ramp).`,
      );
    }
    // grid[y * mapWidth + x] stays 0 (inert) -- no candidate, and either no
    // exception case applies or it already warned above.
  }

  return grid;
}
