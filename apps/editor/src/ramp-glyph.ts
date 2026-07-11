/**
 * Painter ramp authoring (Slice 4 design/spec: "Painter Ramp Authoring" --
 * "the derived or overridden direction is shown as a minimal directional
 * glyph/label on the ramp cell"). Pure -- derives which map cells are
 * ramp-classed and their resolved downhill direction by reusing
 * importer-rpgm's `computeRampGrid` (the single source of truth also used by
 * gameplay/renderer), rather than re-implementing direction derivation here.
 *
 * A cell counts as ramp-classed when ANY of its 4 tile layers carries a tile
 * id whose `semantics` entry has `class: 'ramp'` -- semantic classes are
 * assigned per tile id, not per cell position (see `semantic-store.ts`).
 */

import type { RampCellInput, RampDirection } from '@threemaker/importer-rpgm';
import {
  computeRampGrid,
  heightForRegion,
  RAMP_DIRECTION_BY_CODE,
} from '@threemaker/importer-rpgm';
import type { SemanticOverrides, TileLayerData } from '@threemaker/map-format';

export interface RampGlyphCell {
  readonly x: number;
  readonly y: number;
  readonly direction: RampDirection;
}

/**
 * Every ramp-classed cell on the map, with its resolved downhill direction
 * (override > unique-neighbor > tie-break; a cell with no resolvable
 * direction -- e.g. a multi-level span -- is inert and simply omitted, same
 * as `computeRampGrid`'s own contract). `regions` drives the height grid the
 * same way `@threemaker/importer-rpgm`'s `computeHeightGrid` does for a
 * parsed `RpgmMap`, since the painter's `MapDocument` carries its own
 * `layers.regions` rather than an `RpgmMap`.
 */
export function computeRampGlyphCells(
  layers: readonly [TileLayerData, TileLayerData, TileLayerData, TileLayerData],
  regions: TileLayerData,
  semantics: SemanticOverrides,
  width: number,
  height: number,
): readonly RampGlyphCell[] {
  const size = width * height;
  const heightGrid = new Uint8Array(size);
  for (let i = 0; i < size; i++) heightGrid[i] = heightForRegion(regions[i] ?? 0);

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
  if (rampCells.length === 0) return [];

  const rampGrid = computeRampGrid({ heightGrid, mapWidth: width, mapHeight: height }, rampCells);
  const cells: RampGlyphCell[] = [];
  for (const cell of rampCells) {
    const direction = RAMP_DIRECTION_BY_CODE[rampGrid[cell.y * width + cell.x] ?? 0];
    if (direction) cells.push({ x: cell.x, y: cell.y, direction });
  }
  return cells;
}

/** Unicode arrow glyph pointing downhill, for the painter's display-only ramp overlay (map space: north = smaller y = image-top). */
export const RAMP_DIRECTION_ARROW: Record<RampDirection, string> = {
  north: '↑',
  south: '↓',
  east: '→',
  west: '←',
};
