import type { SemanticOverrides } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeRampGlyphCells, RAMP_DIRECTION_ARROW } from '../src/ramp-glyph.js';

const EMPTY_LAYER = (size: number) => new Array(size).fill(0);

describe('computeRampGlyphCells', () => {
  it('returns nothing when no tile id is ramp-classed', () => {
    const width = 2;
    const height = 1;
    const layers = [
      [7, 0],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'wall' } };
    expect(computeRampGlyphCells(layers, [1, 0], semantics, width, height)).toEqual([]);
  });

  it('derives the downhill direction toward a unique lower neighbor', () => {
    const width = 1;
    const height = 2;
    const layers = [
      [7, 0],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    // regions: cell (0,0) height 1, cell (0,1) height 0 -- south is the unique lower neighbor.
    expect(computeRampGlyphCells(layers, [1, 0], semantics, width, height)).toEqual([
      { x: 0, y: 0, direction: 'south' },
    ]);
  });

  it('honors an explicit rampDirection override over the tie-break candidate', () => {
    const width = 2;
    const height = 2;
    // regions (row-major): (0,0)=1 (0,1)=1
    //                       (1,0)=1 (1,1)=2  <- ramp cell, tied between north(1,0) and west(0,1)
    const regions = [1, 1, 1, 2];
    const layers = [
      [0, 0, 0, 9],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '9': { class: 'ramp', rampDirection: 'north' } };
    expect(computeRampGlyphCells(layers, regions, semantics, width, height)).toEqual([
      { x: 1, y: 1, direction: 'north' },
    ]);
  });

  it('without the override, the same tie resolves to the tie-break default (west)', () => {
    const width = 2;
    const height = 2;
    const regions = [1, 1, 1, 2];
    const layers = [
      [0, 0, 0, 9],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '9': { class: 'ramp' } };
    expect(computeRampGlyphCells(layers, regions, semantics, width, height)).toEqual([
      { x: 1, y: 1, direction: 'west' },
    ]);
  });

  it('finds a ramp-classed tile id on any of the 4 layers, not just layer 0', () => {
    const width = 1;
    const height = 2;
    const layers = [
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      [7, 0],
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    expect(computeRampGlyphCells(layers, [1, 0], semantics, width, height)).toEqual([
      { x: 0, y: 0, direction: 'south' },
    ]);
  });

  it('omits a ramp cell with no resolvable direction (multi-level span, inert)', () => {
    const width = 1;
    const height = 2;
    const layers = [
      [7, 0],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    // regions: cell (0,0) height 3, cell (0,1) height 0 -- 3-level span, no valid candidate.
    expect(computeRampGlyphCells(layers, [3, 0], semantics, width, height)).toEqual([]);
  });
});

describe('RAMP_DIRECTION_ARROW', () => {
  it('maps every RampDirection to a distinct arrow glyph', () => {
    const arrows = Object.values(RAMP_DIRECTION_ARROW);
    expect(new Set(arrows).size).toBe(arrows.length);
    expect(RAMP_DIRECTION_ARROW.north).toBe('↑');
    expect(RAMP_DIRECTION_ARROW.south).toBe('↓');
    expect(RAMP_DIRECTION_ARROW.east).toBe('→');
    expect(RAMP_DIRECTION_ARROW.west).toBe('←');
  });
});
