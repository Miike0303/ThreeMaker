import { describe, expect, it } from 'vitest';
import {
  getAutotileKind,
  getAutotileShape,
  getLocalTileIndex,
  getTileSheet,
  isAutotile,
} from '../src/tile-id.js';

describe('isAutotile', () => {
  it('is false for normal single-frame tile ids (B-E, A5)', () => {
    expect(isAutotile(0)).toBe(false);
    expect(isAutotile(1023)).toBe(false);
    expect(isAutotile(1536)).toBe(false);
    expect(isAutotile(2047)).toBe(false);
  });

  it('is true for A1-A4 autotile ids (2048 and above)', () => {
    expect(isAutotile(2048)).toBe(true);
    expect(isAutotile(4352)).toBe(true);
    expect(isAutotile(8191)).toBe(true);
  });
});

describe('getTileSheet', () => {
  it.each([
    [0, 'B'],
    [255, 'B'],
    [256, 'C'],
    [511, 'C'],
    [512, 'D'],
    [767, 'D'],
    [768, 'E'],
    [1023, 'E'],
    [1536, 'A5'],
    [2047, 'A5'],
    [2048, 'A1'],
    [2815, 'A1'],
    [2816, 'A2'],
    [4351, 'A2'],
    [4352, 'A3'],
    [5887, 'A3'],
    [5888, 'A4'],
    [8191, 'A4'],
  ] as const)('classifies tile id %i as sheet %s', (id, sheet) => {
    expect(getTileSheet(id)).toBe(sheet);
  });

  it('returns null for ids in the unused gap between E and A5 (1024-1535)', () => {
    expect(getTileSheet(1024)).toBeNull();
    expect(getTileSheet(1535)).toBeNull();
  });

  it('returns null for ids at or beyond the max tile id (8192)', () => {
    expect(getTileSheet(8192)).toBeNull();
  });
});

describe('getLocalTileIndex', () => {
  it('is 0-based from each sheet start', () => {
    expect(getLocalTileIndex(0)).toBe(0);
    expect(getLocalTileIndex(256)).toBe(0);
    expect(getLocalTileIndex(2048)).toBe(0);
    expect(getLocalTileIndex(2048 + 47)).toBe(47);
  });

  it('returns null outside any sheet range', () => {
    expect(getLocalTileIndex(1024)).toBeNull();
  });
});

describe('getAutotileKind', () => {
  it('groups every 48 ids into the same kind', () => {
    expect(getAutotileKind(2048)).toBe(0);
    expect(getAutotileKind(2048 + 47)).toBe(0);
    expect(getAutotileKind(2048 + 48)).toBe(1);
  });

  it('kind numbering continues across sheet boundaries (A1 into A2)', () => {
    // A1 spans 2048-2815 = 768 ids = 16 kinds (0-15); A2 starts at kind 16.
    expect(getAutotileKind(2815)).toBe(15);
    expect(getAutotileKind(2816)).toBe(16);
  });
});

describe('getAutotileShape', () => {
  it('is 0 at the start of every 48-id kind block', () => {
    expect(getAutotileShape(2048)).toBe(0);
    expect(getAutotileShape(2048 + 48)).toBe(0);
    expect(getAutotileShape(2816)).toBe(0);
  });

  it('counts up to 47 across a kind block then wraps for the next kind', () => {
    expect(getAutotileShape(2048 + 47)).toBe(47);
    expect(getAutotileShape(2048 + 48)).toBe(0);
  });

  it('matches Tilemap.getAutotileShape semantics: (tileId - TILE_ID_A1) % 48', () => {
    // Arbitrary mid-range id, cross-checked against the corescript formula.
    expect(getAutotileShape(4352 + 130)).toBe(130 % 48);
  });
});
