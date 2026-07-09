import { describe, expect, it } from 'vitest';
import { decodeTileFlags } from '../src/tile-flags.js';

describe('decodeTileFlags', () => {
  it('decodes an all-zero bitfield as fully passable, ground-layer, no terrain tag', () => {
    expect(decodeTileFlags(0)).toEqual({
      impassableDown: false,
      impassableLeft: false,
      impassableRight: false,
      impassableUp: false,
      isUpperLayer: false,
      isLadder: false,
      isBush: false,
      isCounter: false,
      isDamageFloor: false,
      terrainTag: 0,
    });
  });

  it('decodes each passability bit independently', () => {
    expect(decodeTileFlags(0x1).impassableDown).toBe(true);
    expect(decodeTileFlags(0x2).impassableLeft).toBe(true);
    expect(decodeTileFlags(0x4).impassableRight).toBe(true);
    expect(decodeTileFlags(0x8).impassableUp).toBe(true);
  });

  it('decodes the star bit as isUpperLayer', () => {
    expect(decodeTileFlags(0x10).isUpperLayer).toBe(true);
  });

  it('decodes ladder, bush, counter, and damage floor bits', () => {
    expect(decodeTileFlags(0x20).isLadder).toBe(true);
    expect(decodeTileFlags(0x40).isBush).toBe(true);
    expect(decodeTileFlags(0x80).isCounter).toBe(true);
    expect(decodeTileFlags(0x100).isDamageFloor).toBe(true);
  });

  it('decodes the terrain tag from bits 12-15', () => {
    expect(decodeTileFlags(0).terrainTag).toBe(0);
    expect(decodeTileFlags(1 << 12).terrainTag).toBe(1);
    expect(decodeTileFlags(7 << 12).terrainTag).toBe(7);
    expect(decodeTileFlags(0xf << 12).terrainTag).toBe(15);
  });

  it('decodes a real-world all-impassable value (1551) from the Roseliam Tilesets.json', () => {
    // 1551 = 0x60F: bits 0-3 set (impassable on all 4 sides), star bit clear.
    const flags = decodeTileFlags(1551);
    expect(flags.impassableDown).toBe(true);
    expect(flags.impassableLeft).toBe(true);
    expect(flags.impassableRight).toBe(true);
    expect(flags.impassableUp).toBe(true);
    expect(flags.isUpperLayer).toBe(false);
  });

  it('decodes a real-world upper-layer value (1552) from the Roseliam Tilesets.json', () => {
    // 1552 = 0x610: star bit set, no passability bits.
    const flags = decodeTileFlags(1552);
    expect(flags.isUpperLayer).toBe(true);
    expect(flags.impassableDown).toBe(false);
  });
});
