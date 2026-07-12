import type { MapSpawn } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeSpawnOverlayPoint } from '../src/spawn-overlay.js';

describe('computeSpawnOverlayPoint', () => {
  it('returns the spawn point when it is authored on the given floor', () => {
    const spawn: MapSpawn = { x: 3, y: 4, floor: 'floor-0' };
    expect(computeSpawnOverlayPoint(spawn, 'floor-0')).toEqual({ x: 3, y: 4 });
  });

  it('returns undefined when the spawn is authored on a different floor', () => {
    const spawn: MapSpawn = { x: 3, y: 4, floor: 'floor-1' };
    expect(computeSpawnOverlayPoint(spawn, 'floor-0')).toBeUndefined();
  });

  it('returns undefined when no spawn is authored', () => {
    expect(computeSpawnOverlayPoint(undefined, 'floor-0')).toBeUndefined();
  });
});
