/**
 * Pins the painter ramp-geometry bug and the fix: `buildChunks` without
 * rampCells (the pre-fix painter call) leaves a ramp-classed height-step
 * cell flat; passing `documentFloorToRpgm(...).rampCells` attaches the
 * same ramp descriptor the renderer oracle already locks.
 */
import { documentFloorToRpgm } from '@threemaker/importer-rpgm';
import type { FloorDocument, MapDocument } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { buildChunks, type SheetPixelSizes } from '@threemaker/renderer';
import { describe, expect, it } from 'vitest';
import { painterChunkArgs, painterFloorsFromDocument } from '../src/map-compose.js';
import { createPainterState } from '../src/painter-store.js';

const SHEET_SIZES: SheetPixelSizes = {
  B: { width: 768, height: 768 },
};

function emptyLayer(width: number, height: number): number[] {
  return new Array(width * height).fill(0);
}

/** 1x2 column: (0,0) height 3, (0,1) height 2, tile id 1 ramp-classed -- chunk-geometry oracle. */
function rampStepDocument(): MapDocument {
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
    id: 'painter-ramp',
    name: 'Painter Ramp',
    width,
    height,
    tileset: {
      slots: {},
      flags: new Array(8192).fill(0),
      semantics: { '1': { class: 'ramp' } },
      tilePixelSize: 16,
    },
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

describe('painter ramp chunks', () => {
  it('pins the pre-fix painter path: omitting rampCells leaves a ramp-classed height-step cell flat', () => {
    const doc = rampStepDocument();
    const floor = doc.floors[0];
    if (!floor) throw new Error('test setup: rampStepDocument always has floors[0]');
    const { map, tileset } = documentFloorToRpgm(doc, floor);

    const chunks = buildChunks(map, tileset, SHEET_SIZES, 16, undefined, undefined, 16);
    const tiles = chunks[0]?.tiles ?? [];
    const rampTile = tiles.find((tile) => tile.tileY === 0);

    expect(rampTile?.ramp).toBeUndefined();
  });

  it('renders a ramp-classed cell with ramp geometry when documentFloorToRpgm rampCells are passed', () => {
    const doc = rampStepDocument();
    const floor = doc.floors[0];
    if (!floor) throw new Error('test setup: rampStepDocument always has floors[0]');
    const { map, tileset, rampCells } = documentFloorToRpgm(doc, floor);

    const chunks = buildChunks(map, tileset, SHEET_SIZES, 16, undefined, rampCells, 16);
    const tiles = chunks[0]?.tiles ?? [];
    const rampTile = tiles.find((tile) => tile.tileY === 0);
    const flatTile = tiles.find((tile) => tile.tileY === 1);

    expect(rampCells).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(rampTile?.ramp).toEqual({ direction: 'south', highHeight: 3, lowHeight: 2 });
    expect(flatTile?.ramp).toBeUndefined();
  });

  it('painterChunkArgs still places rampCells in the 6th buildChunks slot', () => {
    const doc = rampStepDocument();
    const state = createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      semantics: doc.tileset.semantics,
    });

    const args = painterChunkArgs(doc, state, SHEET_SIZES, undefined);
    const rampCells = args[5];

    expect(rampCells).toEqual(expect.arrayContaining([expect.objectContaining({ x: 0, y: 0 })]));
    expect(rampCells?.length).toBeGreaterThan(0);

    const chunks = buildChunks(...args);
    const tiles = chunks[0]?.tiles ?? [];
    const rampTile = tiles.find((tile) => tile.tileY === 0);

    expect(rampTile?.ramp).toEqual({ direction: 'south', highHeight: 3, lowHeight: 2 });
  });
});
