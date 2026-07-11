import { describe, expect, it } from 'vitest';
import { ElevationField } from '../src/elevation-field.js';
import { buildMap } from './fixtures.js';

describe('ElevationField', () => {
  it('delegates heightAt to the underlying heightGrid, 0 out of bounds', () => {
    const regions = [0, 3, 8]; // ground, height 3, out-of-range region (also ground)
    const map = buildMap(3, 1, {}, regions);
    const field = new ElevationField(map);

    expect(field.heightAt(0, 0)).toBe(0);
    expect(field.heightAt(1, 0)).toBe(3);
    expect(field.heightAt(2, 0)).toBe(0);
    expect(field.heightAt(-1, 0)).toBe(0);
  });

  it('rampDirAt is undefined for every cell with no ramp semantics resolved (default)', () => {
    const map = buildMap(2, 2, {}, [0, 1, 1, 0]);
    const field = new ElevationField(map);

    expect(field.rampDirAt(0, 0)).toBeUndefined();
    expect(field.rampDirAt(1, 0)).toBeUndefined();
    expect(field.rampDirAt(-1, 0)).toBeUndefined();
  });

  it('rampDirAt reflects a resolved ramp cell direction', () => {
    // Center (1,1) height 1; only its west neighbor (0,1) sits at height 0 --
    // north/south/east neighbors are all height 1, so west is unambiguous.
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      1, 1, 1,
      0, 1, 1,
      1, 1, 1,
    ];
    const map = buildMap(3, 3, {}, regions);
    const field = new ElevationField(map, [{ x: 1, y: 1 }]);

    expect(field.rampDirAt(1, 1)).toBe('west');
    expect(field.rampDirAt(0, 1)).toBeUndefined();
  });

  it('surfaceHeightAt is constant across a flat cell regardless of fractional position', () => {
    const regions = [2, 2];
    const map = buildMap(2, 1, {}, regions);
    const field = new ElevationField(map);

    expect(field.surfaceHeightAt(0, 0)).toBe(2);
    expect(field.surfaceHeightAt(0.5, 0.5)).toBe(2);
    expect(field.surfaceHeightAt(0.99, 0.01)).toBe(2);
  });

  it('surfaceHeightAt interpolates linearly across a ramp cell along its slope axis', () => {
    // Same center-ramp fixture as the rampDirAt test above: (1,1) height 1,
    // ramp west toward (0,1) height 0. Cell (1,1) spans fx in [1,2).
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      1, 1, 1,
      0, 1, 1,
      1, 1, 1,
    ];
    const map = buildMap(3, 3, {}, regions);
    const field = new ElevationField(map, [{ x: 1, y: 1 }]);

    expect(field.surfaceHeightAt(1.01, 1.5)).toBeCloseTo(0.01, 10); // near west (downhill) edge -> near H-1 = 0
    expect(field.surfaceHeightAt(1.99, 1.5)).toBeCloseTo(0.99, 10); // near east (uphill) edge -> near H = 1
    expect(field.surfaceHeightAt(1.5, 1.5)).toBeCloseTo(0.5, 10); // midpoint
  });

  it('edgeProfileAt matches importer-rpgm semantics: flat cell edges are constant', () => {
    const regions = [4];
    const map = buildMap(1, 1, {}, regions);
    const field = new ElevationField(map);

    expect(field.edgeProfileAt(0, 0, 'north')).toEqual([4, 4]);
    expect(field.edgeProfileAt(0, 0, 'south')).toEqual([4, 4]);
  });

  it('exposes width/height matching the source map', () => {
    const map = buildMap(5, 3);
    const field = new ElevationField(map);

    expect(field.width).toBe(5);
    expect(field.height).toBe(3);
  });
});
