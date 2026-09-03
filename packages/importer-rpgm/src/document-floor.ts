/**
 * Single `MapDocument` floor -> `buildChunks` projection. The editor painter
 * and the desktop runtime both call this so a ramp-classed cell cannot be
 * sloped in playtest and flat in the painter.
 *
 * Lives here (not in `@threemaker/map-format`) because map-format keeps zero
 * runtime dependencies and already owns the opposite direction
 * (`convertRpgmMap`). `deriveRampCells` is imported from map-format.
 */

import type { FloorDocument, MapDocument, SemanticOverrides } from '@threemaker/map-format';
import { deriveRampCells } from '@threemaker/map-format';
import type { RampCellInput } from './elevation.js';
import type { RpgmMap, RpgmTileset, TileSheetNames } from './types.js';

/** Every RPGM sheet slot mapped to an empty name -- `sheetNames` is unused by the renderer's build pipeline (only caller-provided `sheetPixelSizes` matters). */
const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

export interface DocumentFloorToRpgmResult {
  readonly map: RpgmMap;
  readonly tileset: RpgmTileset;
  readonly rampCells: readonly RampCellInput[];
  readonly tilePixelSize: number;
}

/**
 * Projects one floor into everything `buildChunks` needs.
 *
 * `semantics` overrides `doc.tileset.semantics` when the caller holds live
 * authoring semantics that have not been written back onto the document
 * (the painter store). Desktop passes nothing and uses the document.
 */
export function documentFloorToRpgm(
  doc: MapDocument,
  floor: FloorDocument,
  semantics?: SemanticOverrides,
  rampCells?: readonly RampCellInput[],
): DocumentFloorToRpgmResult {
  const resolvedSemantics = semantics ?? doc.tileset.semantics;
  return {
    map: {
      id: null,
      displayName: doc.name,
      width: doc.width,
      height: doc.height,
      tilesetId: 0,
      scrollType: 0,
      layers: {
        tileLayers: floor.layers.tiles,
        shadows: floor.layers.shadows,
        regions: floor.layers.regions,
      },
    },
    tileset: {
      id: 0,
      name: doc.name,
      sheetNames: EMPTY_SHEET_NAMES,
      flags: doc.tileset.flags,
    },
    rampCells:
      rampCells ?? deriveRampCells(floor.layers.tiles, resolvedSemantics, doc.width, doc.height),
    tilePixelSize: doc.tileset.tilePixelSize,
  };
}
