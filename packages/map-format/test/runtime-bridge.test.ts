/**
 * `deriveRampCells` (loop-crear-jugar design, "Shared pure bridge home"): the
 * same tile-id-scan derivation the painter's `ramp-glyph.ts` used to own
 * privately, lifted here so editor and (later) desktop runtime translation
 * can never diverge. Deliberately stops at the position-keyed cell list --
 * direction resolution via `computeRampGrid`/`heightForRegion` stays
 * consumer-side in `@threemaker/importer-rpgm` (this package keeps zero
 * runtime deps).
 */

import { describe, expect, it } from 'vitest';
import { deriveRampCellAt, deriveRampCells, syncRampCells } from '../src/runtime-bridge.js';
import type { SemanticOverrides } from '../src/schema.js';

const EMPTY_LAYER = (size: number) => new Array(size).fill(0);

describe('deriveRampCells', () => {
  it('uses row-major ramp coordinates when the map width is not a power of two', () => {
    const layers = [[0, 0, 0, 0, 0, 7], EMPTY_LAYER(6), EMPTY_LAYER(6), EMPTY_LAYER(6)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(deriveRampCells(layers, semantics, 3, 2)).toEqual([{ x: 2, y: 1 }]);
  });

  it('ignores trailing ramp tiles beyond the requested map height', () => {
    const layers = [[7, 7], EMPTY_LAYER(2), EMPTY_LAYER(2), EMPTY_LAYER(2)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(deriveRampCells(layers, semantics, 1, 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('omits the direction property when a ramp has no authored override', () => {
    const layers = [[7], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(deriveRampCells(layers, semantics, 1, 1)).toStrictEqual([{ x: 0, y: 0 }]);
  });

  it('treats missing tile entries as empty cells', () => {
    const layers = [
      new Array<number>(1),
      new Array<number>(1),
      new Array<number>(1),
      new Array<number>(1),
    ] as const;
    const semantics: SemanticOverrides = { '1': { class: 'ramp' } };

    expect(deriveRampCells(layers, semantics, 1, 1)).toEqual([]);
  });

  it('does not read tile layers when semantics contain no ramps', () => {
    const width = 16;
    const height = 16;
    const size = width * height;
    const indexReads = { count: 0 };
    const instrument = (raw: number[]): number[] =>
      new Proxy(raw, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) indexReads.count += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
    const layers = [
      instrument(new Array(size).fill(7)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
    ] as const;

    expect(deriveRampCells(layers, { '7': { class: 'wall' } }, width, height)).toEqual([]);
    expect(indexReads.count).toBe(0);
  });

  it('does not read tile layers when semantics are empty', () => {
    const width = 16;
    const height = 16;
    const size = width * height;
    const indexReads = { count: 0 };
    const instrument = (raw: number[]): number[] =>
      new Proxy(raw, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) indexReads.count += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
    const layers = [
      instrument(new Array(size).fill(7)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
    ] as const;

    expect(deriveRampCells(layers, {}, width, height)).toEqual([]);
    expect(indexReads.count).toBe(0);
  });

  it('keeps exact ramp cells and row-major order when ramps exist', () => {
    const width = 4;
    const height = 3;
    const size = width * height;
    const layer0 = new Array(size).fill(0);
    layer0[0 * width + 3] = 7;
    layer0[2 * width + 1] = 7;
    const layers = [layer0, EMPTY_LAYER(size), EMPTY_LAYER(size), EMPTY_LAYER(size)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp', rampDirection: 'east' } };

    expect(deriveRampCells(layers, semantics, width, height)).toEqual([
      { x: 3, y: 0, rampDirection: 'east' },
      { x: 1, y: 2, rampDirection: 'east' },
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
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([]);
  });

  it('ignores empty tile id zero even if semantics mark it as a ramp', () => {
    const layers = [[0], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const semantics: SemanticOverrides = { '0': { class: 'ramp' } };
    expect(deriveRampCells(layers, semantics, 1, 1)).toEqual([]);
  });

  it('emits a position-keyed cell with no direction when the tile carries no override', () => {
    const width = 1;
    const height = 2;
    const layers = [
      [7, 0],
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
      EMPTY_LAYER(width * height),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([{ x: 0, y: 0 }]);
  });

  it('carries the explicit rampDirection override through to the emitted cell', () => {
    const width = 1;
    const height = 1;
    const layers = [[9], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const semantics: SemanticOverrides = { '9': { class: 'ramp', rampDirection: 'north' } };
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([
      { x: 0, y: 0, rampDirection: 'north' },
    ]);
  });

  it('finds a ramp-classed tile id on any of the 4 layers, first non-zero layer bottom-to-top wins', () => {
    const width = 1;
    const height = 1;
    const layers = [[0], [0], [7], [8]] as const;
    const semantics: SemanticOverrides = {
      '7': { class: 'ramp' },
      '8': { class: 'ramp', rampDirection: 'south' },
    };
    // Layer 2 (index 2) is the first non-zero layer scanning bottom-to-top,
    // so its tile id (7, no override) wins over layer 3's id 8 (with override).
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([{ x: 0, y: 0 }]);
  });

  it('finds a ramp on a higher layer above an ordinary ground tile', () => {
    const width = 1;
    const height = 1;
    const layers = [[5], [7], EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(deriveRampCells(layers, semantics, width, height)).toEqual([{ x: 0, y: 0 }]);
  });

  it('scans row-major (y ascending, then x ascending)', () => {
    const width = 2;
    const height = 2;
    const layers = [[7, 0, 0, 7], EMPTY_LAYER(4), EMPTY_LAYER(4), EMPTY_LAYER(4)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('parity oracle: reproduces the same position/override set as desktop main.ts DEMO_RAMP_SEMANTICS', () => {
    // Mirrors apps/desktop/src/main.ts's DEMO_RAMP_SEMANTICS hardcoded oracle:
    // 7 ramp positions, one of them ((11, 4)) carrying a 'north' override that
    // would otherwise tie-break to 'west' -- see ramp-glyph.ts's own tests for
    // that tie-break behavior (direction resolution, out of scope here).
    // Tile id 20 = plain ramp (no override); tile id 21 = ramp with the
    // (11, 4) override -- distinct ids since `semantics` is tile-id-keyed.
    const width = 16;
    const height = 16;
    const size = width * height;
    const layer0 = new Array(size).fill(0);
    const positions: readonly [number, number][] = [
      [9, 7],
      [11, 2],
      [11, 3],
      [11, 4],
      [11, 5],
      [11, 6],
      [11, 7],
    ];
    for (const [x, y] of positions) {
      layer0[y * width + x] = x === 11 && y === 4 ? 21 : 20;
    }
    const layers = [layer0, EMPTY_LAYER(size), EMPTY_LAYER(size), EMPTY_LAYER(size)] as const;
    const semantics: SemanticOverrides = {
      '20': { class: 'ramp' },
      '21': { class: 'ramp', rampDirection: 'north' },
    };

    // Expected in the same row-major (y, then x) scan order the function guarantees.
    expect(deriveRampCells(layers, semantics, width, height)).toEqual([
      { x: 11, y: 2 },
      { x: 11, y: 3 },
      { x: 11, y: 4, rampDirection: 'north' },
      { x: 11, y: 5 },
      { x: 11, y: 6 },
      { x: 9, y: 7 },
      { x: 11, y: 7 },
    ]);
  });
});

describe('syncRampCells', () => {
  it('clears ramps left by repeated dirty coordinates', () => {
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    const painted = [[7], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const previous = syncRampCells([], painted, semantics, 1, [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    const cleared = [[0], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;

    expect(syncRampCells(previous, cleared, semantics, 1, [{ x: 0, y: 0 }])).toEqual([]);
  });

  it('removes a ramp when its only dirty cell is cleared', () => {
    const layers = [[0], EMPTY_LAYER(1), EMPTY_LAYER(1), EMPTY_LAYER(1)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(syncRampCells([{ x: 0, y: 0 }], layers, semantics, 1, [{ x: 0, y: 0 }])).toEqual([]);
  });

  it('restores row order when dirty cells arrive from different rows out of order', () => {
    const layers = [[0, 0, 7, 7, 0, 0], EMPTY_LAYER(6), EMPTY_LAYER(6), EMPTY_LAYER(6)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(
      syncRampCells([], layers, semantics, 3, [
        { x: 0, y: 1 },
        { x: 2, y: 0 },
      ]),
    ).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('restores left-to-right order for dirty ramp cells on the same row', () => {
    const layers = [[7, 0, 7], EMPTY_LAYER(3), EMPTY_LAYER(3), EMPTY_LAYER(3)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

    expect(
      syncRampCells([], layers, semantics, 3, [
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('preserves existing ramp cells when no cells are dirty', () => {
    const previous = [{ x: 1, y: 0 }];
    const layers = [EMPTY_LAYER(2), EMPTY_LAYER(2), EMPTY_LAYER(2), EMPTY_LAYER(2)] as const;
    const semantics: SemanticOverrides = {};

    expect(syncRampCells(previous, layers, semantics, 2, [])).toBe(previous);
  });

  it('matches a full derive when every cell is marked dirty', () => {
    const width = 3;
    const height = 2;
    const size = width * height;
    const layers = [
      [0, 7, 0, 7, 0, 0],
      EMPTY_LAYER(size),
      EMPTY_LAYER(size),
      EMPTY_LAYER(size),
    ] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp', rampDirection: 'east' } };
    const dirty = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    expect(syncRampCells([], layers, semantics, width, dirty)).toEqual(
      deriveRampCells(layers, semantics, width, height),
    );
  });

  it('adds and removes only at dirty coords (parity with full derive)', () => {
    const width = 3;
    const height = 1;
    const layersA = [[7, 0, 7], EMPTY_LAYER(3), EMPTY_LAYER(3), EMPTY_LAYER(3)] as const;
    const layersB = [[7, 7, 0], EMPTY_LAYER(3), EMPTY_LAYER(3), EMPTY_LAYER(3)] as const;
    const semantics: SemanticOverrides = { '7': { class: 'ramp' } };
    const previous = deriveRampCells(layersA, semantics, width, height);
    const synced = syncRampCells(previous, layersB, semantics, width, [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(synced).toEqual(deriveRampCells(layersB, semantics, width, height));
  });

  it('does not scan tile layers outside the dirty cells', () => {
    const width = 64;
    const height = 64;
    const size = width * height;
    const indexReads = { count: 0 };
    const instrument = (raw: number[]): number[] =>
      new Proxy(raw, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) indexReads.count += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
    const layers = [
      instrument(new Array(size).fill(1)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
      instrument(new Array(size).fill(0)),
    ] as const;
    const semantics: SemanticOverrides = {};

    syncRampCells([], layers, semantics, width, [{ x: 3, y: 4 }]);

    // One dirty cell × up to 4 layers (layer 0 has a non-zero tile so deeper
    // layers may still be read). Full derive would be W×H×4 = 16384+.
    expect(indexReads.count).toBeLessThan(16);
    expect(indexReads.count).toBeLessThan(width * height * 4);
  });
});

it('returns undefined from a direct lookup when no layer contributes a ramp', () => {
  const layers = [[5], [0], [0], [0]] as const;
  const semantics: SemanticOverrides = { '5': { class: 'wall' } };

  expect(deriveRampCellAt(layers, semantics, 1, 0, 0)).toBeUndefined();
});

it('skips undefined semantic entries when finding authored ramps', () => {
  const layers = [[8], [0], [0], [0]] as const;
  const semantics: SemanticOverrides = Object.fromEntries([
    ['7', undefined],
    ['8', { class: 'ramp', rampDirection: 'south' }],
  ]);

  expect(deriveRampCells(layers, semantics, 1, 1)).toEqual([
    { x: 0, y: 0, rampDirection: 'south' },
  ]);
});

it('orders dirty ramps left to right on a nonzero row', () => {
  const ground = EMPTY_LAYER(20);
  ground[17] = 7;
  ground[19] = 7;
  const layers = [ground, EMPTY_LAYER(20), EMPTY_LAYER(20), EMPTY_LAYER(20)] as const;
  const semantics: SemanticOverrides = { '7': { class: 'ramp' } };

  expect(
    syncRampCells([], layers, semantics, 4, [
      { x: 3, y: 4 },
      { x: 1, y: 4 },
    ]),
  ).toEqual([
    { x: 1, y: 4 },
    { x: 3, y: 4 },
  ]);
});
