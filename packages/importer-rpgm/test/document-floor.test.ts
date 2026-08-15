/**
 * `documentFloorToRpgm` is the single MapDocument-floor -> buildChunks
 * projection. This file proves the editor painter and desktop runtime agree
 * on ramp cells for the same document (the duplication this export replaces).
 */
import type { FloorDocument, MapDocument, SemanticOverrides } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { translateMapDocument } from '../../../apps/desktop/src/map-document-runtime.js';
import { documentFloorToRpgm } from '../src/document-floor.js';

function emptyLayer(width: number, height: number): number[] {
  return new Array(width * height).fill(0);
}

/** 1x2 height step with tile id 1 ramp-classed on both cells (chunk-geometry oracle shape). */
function rampStepDocument(semantics: SemanticOverrides = { '1': { class: 'ramp' } }): MapDocument {
  const width = 1;
  const height = 2;
  const floor: FloorDocument = {
    id: 'floor-0',
    baseElevation: 0,
    layers: {
      tiles: [
        [1, 1],
        emptyLayer(width, height),
        emptyLayer(width, height),
        emptyLayer(width, height),
      ],
      shadows: emptyLayer(width, height),
      regions: [3, 2],
    },
  };
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'ramp-step',
    name: 'Ramp Step',
    width,
    height,
    tileset: { slots: {}, flags: new Array(8192).fill(0), semantics, tilePixelSize: 48 },
    floors: [floor],
    stairLinks: [],
    rooms: [],
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [],
    lights: [],
  };
}

describe('documentFloorToRpgm', () => {
  it('produces the same rampCells that translateMapDocument produces for the same document', () => {
    const doc = rampStepDocument();
    const floor = doc.floors[0];
    if (!floor) throw new Error('test setup: rampStepDocument always has floors[0]');

    const projected = documentFloorToRpgm(doc, floor);
    const translated = translateMapDocument(doc);

    expect(projected.rampCells).toEqual(translated.floorSources[0]?.rampCells);
    expect(projected.map).toEqual(translated.floorSources[0]?.map);
    expect(projected.tileset).toEqual(translated.floorSources[0]?.tileset);
  });

  it('projects map, tileset and tilePixelSize from the document floor', () => {
    const doc = rampStepDocument();
    const floor = doc.floors[0];
    if (!floor) throw new Error('test setup: rampStepDocument always has floors[0]');

    const projected = documentFloorToRpgm(doc, floor);

    expect(projected.map).toEqual({
      id: null,
      displayName: 'Ramp Step',
      width: 1,
      height: 2,
      tilesetId: 0,
      scrollType: 0,
      layers: {
        tileLayers: floor.layers.tiles,
        shadows: floor.layers.shadows,
        regions: floor.layers.regions,
      },
    });
    expect(projected.tileset).toEqual({
      id: 0,
      name: 'Ramp Step',
      sheetNames: { A1: '', A2: '', A3: '', A4: '', A5: '', B: '', C: '', D: '', E: '' },
      flags: doc.tileset.flags,
    });
    expect(projected.tilePixelSize).toBe(48);
    expect(projected.rampCells).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('uses the semantics override when provided, not the document tileset semantics', () => {
    const doc = rampStepDocument({});
    const floor = doc.floors[0];
    if (!floor) throw new Error('test setup: rampStepDocument always has floors[0]');

    expect(documentFloorToRpgm(doc, floor).rampCells).toEqual([]);
    expect(documentFloorToRpgm(doc, floor, { '1': { class: 'ramp' } }).rampCells).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
  });
});
