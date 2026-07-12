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
import { deriveRampCells } from '../src/runtime-bridge.js';
import type { SemanticOverrides } from '../src/schema.js';

const EMPTY_LAYER = (size: number) => new Array(size).fill(0);

describe('deriveRampCells', () => {
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
