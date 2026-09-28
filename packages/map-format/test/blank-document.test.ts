import { describe, expect, it } from 'vitest';
import {
  CURRENT_MAP_FORMAT_VERSION,
  createBlankMapDocument,
  parseMapDocument,
  serializeMapDocument,
  validateCurrentVersionShape,
} from '../src/index.js';

const BLANK_OPTIONS = {
  id: 'blank-test',
  name: 'Blank Test',
  width: 8,
  height: 6,
  slots: {},
  flags: new Array(8192).fill(0),
} as const;

describe('createBlankMapDocument', () => {
  it('preserves the supplied tileset slot composition', () => {
    const slots = { A1: { object: 'a'.repeat(64) } };
    const doc = createBlankMapDocument({ ...BLANK_OPTIONS, slots });

    expect(doc.tileset.slots).toEqual(slots);
  });

  it('preserves the supplied tileset flags', () => {
    const flags = [0, 7, 15];
    const doc = createBlankMapDocument({ ...BLANK_OPTIONS, flags });

    expect(doc.tileset.flags).toEqual(flags);
  });

  it('preserves the supplied display name independently of the map id', () => {
    expect(createBlankMapDocument(BLANK_OPTIONS).name).toBe('Blank Test');
  });

  it('starts a new map at zero base elevation', () => {
    expect(createBlankMapDocument(BLANK_OPTIONS).floors[0]?.baseElevation).toBe(0);
  });

  it('returns a valid current-version document with empty narrative ports', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.npcs).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
    expect(doc.worldSeeds).toEqual({});
    expect(validateCurrentVersionShape(doc)).toEqual(doc);
  });

  it('allocates an independent array for every tile, shadow, and region layer', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    const layers = doc.floors[0]?.layers;
    expect(layers).toBeDefined();
    if (layers === undefined) throw new Error('Blank document is missing its first floor.');

    const layerArrays = [...layers.tiles, layers.shadows, layers.regions];
    expect(new Set(layerArrays).size).toBe(layerArrays.length);
  });

  it('initializes every tile, shadow, and region cell to zero', () => {
    const layers = createBlankMapDocument(BLANK_OPTIONS).floors[0]?.layers;
    if (layers === undefined) throw new Error('Blank document is missing its first floor.');

    for (const layer of [...layers.tiles, layers.shadows, layers.regions]) {
      expect(layer).toHaveLength(BLANK_OPTIONS.width * BLANK_OPTIONS.height);
      expect(layer.every((tileId) => tileId === 0)).toBe(true);
    }
  });

  it('uses the standard 48-pixel tile size for a new map', () => {
    expect(createBlankMapDocument(BLANK_OPTIONS).tileset.tilePixelSize).toBe(48);
  });

  it('round-trips through parseMapDocument', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    const parsed = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
    expect(parsed.id).toBe('blank-test');
    expect(parsed.floors).toHaveLength(1);
    expect(parsed.floors[0]?.id).toBe('floor-0');
  });
});
