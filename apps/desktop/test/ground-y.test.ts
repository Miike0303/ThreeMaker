import { ElevationField } from '@threemaker/gameplay';
import type { RpgmMap, RpgmMapLayers, TileLayer } from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import { groundYAt } from '../src/ground-y.js';

const HEIGHT_UNIT = 1;

/** Builds a minimal synthetic `RpgmMap`. `regions` defaults to all-zero (ground level everywhere). */
function buildMap(width: number, height: number, regions?: TileLayer): RpgmMap {
  const size = width * height;
  const zeros: TileLayer = new Array(size).fill(0);
  const tileLayers: RpgmMapLayers['tileLayers'] = [zeros, zeros, zeros, zeros];

  return {
    id: 1,
    displayName: 'synthetic',
    width,
    height,
    tilesetId: 1,
    scrollType: 0,
    layers: { tileLayers, shadows: zeros, regions: regions ?? zeros },
  };
}

describe('groundYAt', () => {
  it('flat step unchanged: constant world Y across a fractional position on a flat cell', () => {
    const map = buildMap(2, 1, [3, 3]);
    const elevation = new ElevationField(map);

    expect(groundYAt(elevation, 0, 0, HEIGHT_UNIT)).toBe(3);
    expect(groundYAt(elevation, 0.5, 0, HEIGHT_UNIT)).toBe(3);
    expect(groundYAt(elevation, 1.0, 0, HEIGHT_UNIT)).toBe(3);
  });

  it('ramp step lerps: mid-step fractional position interpolates between the two connected heights', () => {
    // Center (1,1) height 1, ramp west toward (0,1) height 0 (explicit
    // override sidesteps tie-break ambiguity from off-map neighbors).
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      1, 1, 1,
      0, 1, 1,
      1, 1, 1,
    ];
    const map = buildMap(3, 3, regions);
    const elevation = new ElevationField(map, [{ x: 1, y: 1, rampDirection: 'west' }]);

    // A step from (0,1) to (1,1) (rightward, ascending the ramp): progress 0
    // sits at fx=0 (height 0), progress 1 sits at fx=1 (still the ramp
    // cell's own downhill edge = 0); the climb happens crossing fx=1..2.
    // Sample mid-ramp instead, matching how main.ts feeds renderPosition.
    expect(groundYAt(elevation, 1.5, 1.5, HEIGHT_UNIT)).toBeCloseTo(0.5, 10);
    expect(groundYAt(elevation, 1.01, 1.5, HEIGHT_UNIT)).toBeCloseTo(0.01, 10);
    expect(groundYAt(elevation, 1.99, 1.5, HEIGHT_UNIT)).toBeCloseTo(0.99, 10);
  });

  it('applies heightUnit as a scale factor', () => {
    const map = buildMap(1, 1, [2]);
    const elevation = new ElevationField(map);

    expect(groundYAt(elevation, 0, 0, 1)).toBe(2);
    expect(groundYAt(elevation, 0, 0, 4)).toBe(8);
  });

  it('teleport (integer, non-stepped) position snaps directly to the destination height, no interpolation', () => {
    const regions = [0, 5]; // (0,0) ground, (1,0) height 5 -- non-ramp cliff
    const map = buildMap(2, 1, regions);
    const elevation = new ElevationField(map);

    // A teleport sets the mover's tile (and renderPosition) directly to an
    // integer destination tile -- never a fractional in-between value -- so
    // querying at that exact integer position returns the destination's own
    // height outright, with no lerp toward the previous tile.
    expect(groundYAt(elevation, 1, 0, HEIGHT_UNIT)).toBe(5);
  });
});
