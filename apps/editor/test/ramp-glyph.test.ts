import type { SemanticOverrides } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeRampGlyphCells, RAMP_DIRECTION_ARROW } from '../src/ramp-glyph.js';

const EMPTY_LAYER = (size: number) => new Array(size).fill(0);

describe('computeRampGlyphCells', () => {
  it('resolves a ramp on the second row of a rectangular map', () => {
    const layers = [[0, 0, 0, 0, 7, 0], EMPTY_LAYER(6), EMPTY_LAYER(6), EMPTY_LAYER(6)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp', rampDirection: 'east' } };

    expect(computeRampGlyphCells(layers, [0, 0, 0, 0, 1, 0], semantics, 3, 2)).toEqual([
      { x: 1, y: 1, direction: 'east' },
    ]);
  });

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

  it('uses the last row of a square map when resolving a ramp direction', () => {
    const width = 3;
    const height = 3;
    const layers = [
      [0, 0, 0, 0, 0, 0, 0, 7, 0],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(
      computeRampGlyphCells(layers, [0, 0, 0, 0, 0, 0, 0, 1, 0], semantics, width, height),
    ).toEqual([{ x: 1, y: 2, direction: 'south' }]);
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

it('treats a missing neighbor region as ground level when resolving a ramp', () => {
  const layers = [[7, 0], EMPTY_LAYER(2), EMPTY_LAYER(2), EMPTY_LAYER(2)] as const;
  const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

  expect(computeRampGlyphCells(layers, [1], semantics, 1, 2)).toEqual([
    { x: 0, y: 0, direction: 'south' },
  ]);
});
