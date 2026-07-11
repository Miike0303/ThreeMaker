import { ElevationField, PassabilityGrid } from '@threemaker/gameplay';
import { describe, expect, it } from 'vitest';
import { buildFloorGameplay, createFloorRouter } from '../src/floor-runtime.js';
import { buildMap, buildTileset } from './fixtures.js';

describe('buildFloorGameplay', () => {
  it('builds one independent ElevationField + PassabilityGrid per floor, carrying floorId/baseElevation', () => {
    // biome-ignore format: grid literal reads clearer un-wrapped
    const cliffMap = buildMap(2, 1, [0, 5]); // (0,0) height 0, (1,0) height 5: a cliff, no ramp
    const tileset = buildTileset();

    const floor = buildFloorGameplay('floor-0', 0, cliffMap, tileset);

    expect(floor.floorId).toBe('floor-0');
    expect(floor.baseElevation).toBe(0);
    expect(floor.elevation).toBeInstanceOf(ElevationField);
    expect(floor.passability).toBeInstanceOf(PassabilityGrid);
    // The cliff blocks a step across it (no ramp cell resolves it) -- proves
    // the built PassabilityGrid actually reads this floor's own map/elevation.
    expect(floor.passability.canMove(0, 0, 'right')).toBe(false);
  });

  it('two floors built from different maps are fully independent instances', () => {
    const flatMap = buildMap(2, 1, [0, 0]);
    // biome-ignore format: grid literal reads clearer un-wrapped
    const cliffMap = buildMap(2, 1, [0, 5]);
    const tileset = buildTileset();

    const floorA = buildFloorGameplay('floor-0', 0, cliffMap, tileset);
    const floorB = buildFloorGameplay('floor-1', 3, flatMap, tileset);

    expect(floorA.passability.canMove(0, 0, 'right')).toBe(false);
    expect(floorB.passability.canMove(0, 0, 'right')).toBe(true);
    expect(floorA.elevation.heightAt(1, 0)).toBe(5);
    expect(floorB.elevation.heightAt(1, 0)).toBe(0);
  });
});

describe('createFloorRouter', () => {
  function buildTwoFloorRouter() {
    const tileset = buildTileset();
    // biome-ignore format: grid literal reads clearer un-wrapped
    const cliffMap = buildMap(2, 1, [0, 5]); // floor 0: a cliff blocks (0,0)->(1,0)
    const flatMap = buildMap(2, 1, [0, 0]); // floor 1: fully flat, same footprint

    const floor0 = buildFloorGameplay('floor-0', 0, cliffMap, tileset);
    const floor1 = buildFloorGameplay('floor-1', 3, flatMap, tileset);
    return createFloorRouter([floor0, floor1]);
  }

  it('defaults to floor 0 and routes canMove/elevation to it', () => {
    const router = buildTwoFloorRouter();

    expect(router.currentFloor).toBe(0);
    expect(router.passability.canMove(0, 0, 'right')).toBe(false);
    expect(router.elevation.heightAt(1, 0)).toBe(5);
  });

  it('routes canMove/elevation to whichever floor is set as current', () => {
    const router = buildTwoFloorRouter();

    router.currentFloor = 1;
    expect(router.passability.canMove(0, 0, 'right')).toBe(true);
    expect(router.elevation.heightAt(1, 0)).toBe(0);
  });

  it("floor A's own results are unaffected by having queried floor B in between (independent containers)", () => {
    const router = buildTwoFloorRouter();

    expect(router.passability.canMove(0, 0, 'right')).toBe(false); // floor 0

    router.currentFloor = 1;
    expect(router.passability.canMove(0, 0, 'right')).toBe(true); // floor 1

    router.currentFloor = 0;
    // Back on floor 0: still blocked by its own cliff, unchanged by the
    // floor-1 query in between -- proves the two containers never share state.
    expect(router.passability.canMove(0, 0, 'right')).toBe(false);
    expect(router.elevation.heightAt(1, 0)).toBe(5);
  });

  it('throws a clear error when currentFloor points past the end of the floors array', () => {
    const router = buildTwoFloorRouter();
    router.currentFloor = 2;

    expect(() => router.passability).toThrow(/no floor at index 2/i);
  });

  it('throws the same clear error for a negative currentFloor index', () => {
    const router = buildTwoFloorRouter();
    router.currentFloor = -1;

    expect(() => router.passability).toThrow(/no floor at index -1/i);
    expect(() => router.elevation).toThrow(/no floor at index -1/i);
  });
});

describe('single-floor regression: floor-container routing is byte-identical to constructing PassabilityGrid/ElevationField directly', () => {
  it('matches direct construction across every cell/direction on a ramp+flat fixture', () => {
    // Mirrors ground-y.test.ts's ramp fixture: center (1,1) height 1, ramp
    // west toward (0,1) height 0.
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      1, 1, 1,
      0, 1, 1,
      1, 1, 1,
    ];
    const map = buildMap(3, 3, regions);
    const tileset = buildTileset();
    const rampCells = [{ x: 1, y: 1, rampDirection: 'west' as const }];

    // "v1 baseline": today's direct single-map construction, no floor container.
    const baselineElevation = new ElevationField(map, rampCells);
    const baselinePassability = new PassabilityGrid(map, tileset, baselineElevation);

    // Floor-container path (this slice).
    const floor = buildFloorGameplay('floor-0', 0, map, tileset, rampCells);
    const router = createFloorRouter([floor]);

    const directions = ['up', 'down', 'left', 'right'] as const;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(router.elevation.heightAt(x, y)).toBe(baselineElevation.heightAt(x, y));
        for (const direction of directions) {
          expect(router.passability.canMove(x, y, direction)).toBe(
            baselinePassability.canMove(x, y, direction),
          );
        }
      }
    }
  });
});
