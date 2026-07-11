import type {
  EdgeDirection,
  EdgeProfile,
  GridContext,
  RampCellInput,
  RampDirection,
  RpgmMap,
} from '@threemaker/importer-rpgm';
import {
  computeHeightGrid,
  computeRampGrid,
  edgeProfileAt,
  RAMP_DIRECTION_BY_CODE,
  surfaceHeightAt,
} from '@threemaker/importer-rpgm';

/**
 * Gameplay's read-only view of a map's per-cell elevation + ramp slope data
 * (design doc "Ramps y Escaleras", section "edge height profile"). Wraps
 * importer-rpgm's pure `GridContext` primitives (`edgeProfileAt`,
 * `surfaceHeightAt`) behind one object built once per map session -- the
 * SAME instance is meant to be shared by `PassabilityGrid.canMove` (the
 * edge-profile passability rule) and the app layer's height sampling
 * (character/NPC/camera Y), so both consumers read the identical
 * `heightGrid`/`rampGrid` data and can never disagree about where a ramp's
 * surface sits.
 *
 * `rampCells`, when given, is the resolved list of map cells classified
 * `'ramp'` by tileset semantics (mirrors `@threemaker/renderer`'s own
 * `buildChunks(..., rampCells)` param -- this class never re-derives ramp
 * semantics itself, matching the one-directional layering importer-rpgm's
 * `RampCellInput` doc describes). Omitted/empty degenerates every ramp
 * lookup to "no ramp" (an all-zero `rampGrid`), so a map with no
 * ramp-tagged cells behaves byte-identically to before this feature
 * existed.
 */
export class ElevationField {
  private readonly ctx: GridContext;

  constructor(map: RpgmMap, rampCells: readonly RampCellInput[] = []) {
    const heightGrid = computeHeightGrid(map);
    const rampGrid = computeRampGrid(
      { heightGrid, mapWidth: map.width, mapHeight: map.height },
      rampCells,
    );
    this.ctx = { heightGrid, rampGrid, mapWidth: map.width, mapHeight: map.height };
  }

  get width(): number {
    return this.ctx.mapWidth;
  }

  get height(): number {
    return this.ctx.mapHeight;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.ctx.mapWidth && y < this.ctx.mapHeight;
  }

  /** Region-derived elevation (tile-height units) at `(x, y)`; 0 for an out-of-bounds query. */
  heightAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.ctx.heightGrid[y * this.ctx.mapWidth + x] ?? 0;
  }

  /** This cell's ramp downhill direction, or `undefined` for a flat (non-ramp) cell / out-of-bounds query. */
  rampDirAt(x: number, y: number): RampDirection | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const code = this.ctx.rampGrid[y * this.ctx.mapWidth + x] ?? 0;
    return RAMP_DIRECTION_BY_CODE[code];
  }

  /** The two corner surface heights of `(x,y)`'s `edge`, in canonical order -- see importer-rpgm's `edgeProfileAt`. */
  edgeProfileAt(x: number, y: number, edge: EdgeDirection): EdgeProfile {
    return edgeProfileAt(this.ctx, x, y, edge);
  }

  /**
   * Interpolated surface height (tile-height units) at fractional position
   * `(fx,fy)` -- see importer-rpgm's `surfaceHeightAt`. Used for
   * mover/camera Y sampling so a ramp step rises/falls continuously instead
   * of popping at step completion.
   */
  surfaceHeightAt(fx: number, fy: number): number {
    return surfaceHeightAt(this.ctx, fx, fy);
  }
}
