import { describe, expect, it } from 'vitest';
import { clampRange, clampRoomRect, clampTileIndex } from '../src/clamp.js';

describe('clampRange', () => {
  it('clamps within the given [min, max]', () => {
    expect(clampRange(1, 3, 20)).toBe(3);
    expect(clampRange(100, 3, 20)).toBe(20);
    expect(clampRange(10, 3, 20)).toBe(10);
  });

  it('normalizes an inverted range instead of throwing', () => {
    expect(clampRange(5, 20, 3)).toBe(5);
    expect(clampRange(-5, 20, 3)).toBe(3);
  });

  it('treats NaN as the range lower bound', () => {
    expect(clampRange(Number.NaN, 3, 20)).toBe(3);
  });
});

describe('clampTileIndex', () => {
  it('returns tile zero when the map size is infinite', () => {
    expect(clampTileIndex(2, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('clamps into [0, size) as an integer tile index', () => {
    expect(clampTileIndex(0, 4)).toBe(0);
    expect(clampTileIndex(3, 4)).toBe(3);
    expect(clampTileIndex(-1, 4)).toBe(0);
    expect(clampTileIndex(99, 4)).toBe(3);
  });

  it('floors non-integers then clamps', () => {
    expect(clampTileIndex(1.9, 4)).toBe(1);
    expect(clampTileIndex(3.7, 4)).toBe(3);
  });

  it('returns 0 for non-finite value or non-positive size', () => {
    expect(clampTileIndex(Number.NaN, 4)).toBe(0);
    expect(clampTileIndex(2, 0)).toBe(0);
    expect(clampTileIndex(2, -1)).toBe(0);
  });
});

describe('clampRoomRect', () => {
  it('uses the top edge when a room origin has a non-finite y coordinate', () => {
    expect(clampRoomRect({ x: 2, y: Number.NaN, width: 2, height: 2 }, 5, 5)).toEqual({
      x: 2,
      y: 0,
      width: 2,
      height: 2,
    });
  });

  it('floors a fractional room y origin before placing the room', () => {
    expect(clampRoomRect({ x: 2, y: 1.9, width: 1, height: 1 }, 5, 5)).toEqual({
      x: 2,
      y: 1,
      width: 1,
      height: 1,
    });
  });

  it('floors a fractional room x origin before placing the room', () => {
    expect(clampRoomRect({ x: 1.9, y: 2, width: 1, height: 1 }, 5, 5)).toEqual({
      x: 1,
      y: 2,
      width: 1,
      height: 1,
    });
  });

  it('keeps a room on a one-tile map', () => {
    expect(clampRoomRect({ x: 0, y: 0, width: 1, height: 1 }, 1, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('keeps in-bounds rects unchanged', () => {
    expect(clampRoomRect({ x: 1, y: 1, width: 2, height: 2 }, 4, 4)).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });
  });

  it('clamps OOB origin and shrinks size to fit (WU-UTIL-05)', () => {
    expect(clampRoomRect({ x: -2, y: 99, width: 3, height: 3 }, 4, 4)).toEqual({
      x: 0,
      y: 3,
      width: 3,
      height: 1,
    });
    expect(clampRoomRect({ x: 2, y: 2, width: 10, height: 10 }, 4, 4)).toEqual({
      x: 2,
      y: 2,
      width: 2,
      height: 2,
    });
  });

  it('returns undefined for non-positive size or empty map', () => {
    expect(clampRoomRect({ x: 0, y: 0, width: 0, height: 1 }, 4, 4)).toBeUndefined();
    expect(clampRoomRect({ x: 0, y: 0, width: 1, height: 1 }, 0, 4)).toBeUndefined();
  });

  it('floors a fractional room width before fitting it inside the map', () => {
    expect(clampRoomRect({ x: 1, y: 1, width: 2.9, height: 1 }, 5, 5)).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 1,
    });
  });

  it('floors a fractional room height before fitting it inside the map', () => {
    expect(clampRoomRect({ x: 1, y: 1, width: 1, height: 2.9 }, 5, 5)).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 2,
    });
  });

  it('uses the left edge when a room origin has a non-finite x coordinate', () => {
    expect(clampRoomRect({ x: Number.NaN, y: 2, width: 2, height: 2 }, 5, 5)).toEqual({
      x: 0,
      y: 2,
      width: 2,
      height: 2,
    });
  });
});
