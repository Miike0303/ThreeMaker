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
 * cell list (shape-compatible with `@threemaker/importer-rpgm`'s
 * `RampCellInput`, but not importing that type). Direction resolution
 * (`computeRampGrid`/`heightForRegion`, tie-break rules) stays consumer-side
 * in `@threemaker/importer-rpgm` -- see `apps/editor/src/ramp-glyph.ts`,
 * which calls `deriveRampCells` and then resolves directions itself.
 */
import type { RampDirection, SemanticOverrides, TileLayerData } from './schema.js';

/** One derived ramp cell: its grid position, plus the tile-id's explicit direction override, if any. Structurally compatible with `@threemaker/importer-rpgm`'s `RampCellInput`. */
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
      const index = y * width + x;
      for (const layer of layers) {
        const tileId = layer[index] ?? 0;
        if (tileId === 0) continue;
        const entry = semantics[String(tileId)];
        if (entry?.class === 'ramp') {
          rampCells.push(
            entry.rampDirection === undefined
              ? { x, y }
              : { x, y, rampDirection: entry.rampDirection },
          );
          break;
        }
      }
    }
  }
  return rampCells;
}
