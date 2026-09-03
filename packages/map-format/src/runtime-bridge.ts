/**
 * Runtime bridge (loop-crear-jugar design, "Shared pure bridge home"):
 * derivation logic a `.tmmap` consumer needs to translate an authored
 * `MapDocument` floor into runtime-ready shapes, lifted out of the editor so
 * editor authoring and future runtime translation can never diverge on the
 * same tile-id-to-position derivation.
 *
 * `@threemaker/map-format` keeps ZERO runtime dependencies (repo convention:
 * this package is pure/browser-safe with no Node/render-stack imports) --
 * `deriveRampCells` therefore only produces the STRUCTURAL, position-keyed
 * cell list ({@link RampCellInput}). Direction resolution
 * (`computeRampGrid`/`heightForRegion`, tie-break rules) stays consumer-side
 * in `@threemaker/importer-rpgm` -- see `apps/editor/src/ramp-glyph.ts`,
 * which calls `deriveRampCells` and then resolves directions itself.
 */
import type { RampDirection, SemanticOverrides, TileLayerData } from './schema.js';

/** One derived ramp cell: its grid position, plus the tile-id's explicit direction override, if any. Re-exported by `@threemaker/importer-rpgm` so paint and play share one shape. */
export interface RampCellInput {
  readonly x: number;
  readonly y: number;
  /** Only present when the winning tile id's `TileSemanticEntry.rampDirection` was set. */
  readonly rampDirection?: RampDirection;
}

/**
 * Per cell, scans the 4 tile layers bottom-to-top; the first non-zero tile id
 * whose `semantics[String(id)].class === 'ramp'` wins and the scan moves to
 * the next cell (`break`). A cell with no ramp-classed tile id on any layer
 * contributes nothing. Row-major iteration (y ascending, then x ascending)
 * is part of this function's contract -- callers may rely on the emitted
 * order. Lifted byte-for-byte from `apps/editor/src/ramp-glyph.ts`'s
 * `computeRampGlyphCells` loop (its `rampCells` build step).
 */
export function deriveRampCells(
  layers: readonly [TileLayerData, TileLayerData, TileLayerData, TileLayerData],
  semantics: SemanticOverrides,
  width: number,
  height: number,
): readonly RampCellInput[] {
  const rampCells: RampCellInput[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = deriveRampCellAt(layers, semantics, width, x, y);
      if (cell) rampCells.push(cell);
    }
  }
  return rampCells;
}

/**
 * Winning ramp contribution of one cell (or `undefined` if none). Same
 * bottom-to-top first-non-zero-ramp rule as {@link deriveRampCells}.
 */
export function deriveRampCellAt(
  layers: readonly [TileLayerData, TileLayerData, TileLayerData, TileLayerData],
  semantics: SemanticOverrides,
  width: number,
  x: number,
  y: number,
): RampCellInput | undefined {
  const index = y * width + x;
  for (const layer of layers) {
    const tileId = layer[index] ?? 0;
    if (tileId === 0) continue;
    const entry = semantics[String(tileId)];
    if (entry?.class === 'ramp') {
      return entry.rampDirection === undefined
        ? { x, y }
        : { x, y, rampDirection: entry.rampDirection };
    }
  }
  return undefined;
}

/**
 * Patch a previously derived ramp-cell list for a set of dirty tile coords.
 * Cells not in `dirtyCells` keep their prior entry. Used by the painter so
 * ordinary ground strokes on large maps do not re-scan W×H×layers.
 *
 * Callers must pass a fresh full {@link deriveRampCells} result whenever
 * `semantics` changes (a class retag of tile id N affects every cell holding
 * N, not only the stroked ones).
 */
export function syncRampCells(
  previous: readonly RampCellInput[],
  layers: readonly [TileLayerData, TileLayerData, TileLayerData, TileLayerData],
  semantics: SemanticOverrides,
  width: number,
  dirtyCells: readonly { readonly x: number; readonly y: number }[],
): readonly RampCellInput[] {
  if (dirtyCells.length === 0) return previous;

  const dirtyKeys = new Set(dirtyCells.map((cell) => `${cell.x},${cell.y}`));
  const next = previous.filter((cell) => !dirtyKeys.has(`${cell.x},${cell.y}`));
  for (const dirty of dirtyCells) {
    const cell = deriveRampCellAt(layers, semantics, width, dirty.x, dirty.y);
    if (cell) next.push(cell);
  }
  // Restore row-major order (deriveRampCells contract) after appends.
  next.sort((a, b) => a.y - b.y || a.x - b.x);
  return next;
}
