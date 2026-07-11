import { describe, expect, it } from 'vitest';
import { ElevationField } from '../src/elevation-field.js';
import { StairTraversal } from '../src/stair-traversal.js';
import { buildMap } from './fixtures.js';

const HEIGHT_UNIT = 1;
const SPEED = 4; // tiles/second, matching GridMover's default convention

// Synthetic 8x8 2-floor L-shaped stair fixture: floor 0 is flat ground
// (baseElevation 0), floor 1 is flat ground one level up (baseElevation 3,
// matching DEFAULT_FLOOR_HEIGHT). Both floors are flat (no ramp semantics)
// so `surfaceHeightAt` is a constant 0 everywhere on each floor -- the ONLY
// vertical rise across the traversal comes from the floor-to-floor
// `baseElevation` term, exactly like a real stair-link between two flat
// floors.
const FLOOR_0 = { baseElevation: 0, elevation: new ElevationField(buildMap(8, 8)) };
const FLOOR_1 = { baseElevation: 3, elevation: new ElevationField(buildMap(8, 8)) };
const FLOORS = [FLOOR_0, FLOOR_1];

describe('StairTraversal (straight 2-waypoint climb)', () => {
  it('interpolates x/y/worldY from the entry waypoint to the landing, done fires at the end', () => {
    const traversal = new StairTraversal({
      waypoints: [
        { x: 2, y: 2, floor: 0 },
        { x: 2, y: 2, floor: 1 },
      ],
      floors: FLOORS,
      speed: SPEED,
      heightUnit: HEIGHT_UNIT,
    });

    // Zero-length x/y segment (both waypoints share the same cell -- a
    // straight-up stair footprint): the "distance" is nominally 1 tile so a
    // vertical-only climb still takes a real amount of time, not an instant
    // teleport. Halfway through that nominal 1-tile distance at speed 4
    // tiles/s is 0.5/4 = 0.125s.
    const mid = traversal.update(0.125);
    expect(mid.x).toBe(2);
    expect(mid.y).toBe(2);
    expect(mid.worldY).toBeCloseTo(1.5, 10); // halfway between baseElevation 0 and 3
    expect(mid.done).toBe(false);

    const end = traversal.update(1); // well past the remaining distance
    expect(end.x).toBe(2);
    expect(end.y).toBe(2);
    expect(end.worldY).toBeCloseTo(3, 10); // landing Y == destination floor's groundY
    expect(end.done).toBe(true);
  });

  it('done stays true and the frame stays pinned to the landing on further updates (fires once)', () => {
    const traversal = new StairTraversal({
      waypoints: [
        { x: 2, y: 2, floor: 0 },
        { x: 2, y: 2, floor: 1 },
      ],
      floors: FLOORS,
      speed: SPEED,
      heightUnit: HEIGHT_UNIT,
    });

    traversal.update(1);
    const first = traversal.update(1);
    const second = traversal.update(1);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    expect(second).toEqual(first);
  });
});

describe('StairTraversal (L-turn 3-waypoint climb)', () => {
  it('follows a direction change mid-path with no edge-profile check on the interior waypoint', () => {
    // (2,2) on floor 0 -> (4,2) on floor 0 (east, interior turn corner) ->
    // (4,4) on floor 1 (south + floor change). A ramp/passability rule could
    // never represent this L-shape as adjacent cells; the walker just
    // follows the authored waypoints.
    const traversal = new StairTraversal({
      waypoints: [
        { x: 2, y: 2, floor: 0 },
        { x: 4, y: 2, floor: 0 },
        { x: 4, y: 4, floor: 1 },
      ],
      floors: FLOORS,
      speed: SPEED,
      heightUnit: HEIGHT_UNIT,
    });

    // First segment: (2,2)->(4,2), distance 2 tiles, at speed 4 tiles/s ->
    // 0.5s to finish. Advance to the exact midpoint of the FIRST segment.
    const midFirstLeg = traversal.update(0.25);
    expect(midFirstLeg.x).toBeCloseTo(3, 10);
    expect(midFirstLeg.y).toBeCloseTo(2, 10);
    expect(midFirstLeg.worldY).toBeCloseTo(0, 10); // still floor 0 throughout leg 1
    expect(midFirstLeg.done).toBe(false);

    // Finish leg 1 (0.25s more) then advance partway into leg 2: (4,2)->(4,4)
    // on floor 1, distance 2 tiles -> 0.5s to finish; 0.25s in is the
    // midpoint of leg 2.
    traversal.update(0.25);
    const midSecondLeg = traversal.update(0.25);
    expect(midSecondLeg.x).toBeCloseTo(4, 10);
    expect(midSecondLeg.y).toBeCloseTo(3, 10);
    expect(midSecondLeg.worldY).toBeCloseTo(1.5, 10); // halfway climbing floor 0 -> floor 1
    expect(midSecondLeg.done).toBe(false);

    const end = traversal.update(1);
    expect(end.x).toBe(4);
    expect(end.y).toBe(4);
    expect(end.worldY).toBeCloseTo(3, 10);
    expect(end.done).toBe(true);
  });
});

describe('StairTraversal (descent, bidirectional reverse)', () => {
  it('walks the SAME link in reverse (toFloor -> fromFloor) when the caller reverses the waypoint order', () => {
    // A bidirectional stair-link's reverse traversal is authored by the
    // CALLER reversing the waypoint array (design: "bidirectional: true is
    // the authoring act for a return path, traversed via the reversed
    // waypoint order") -- the walker itself has no notion of direction, it
    // just follows whatever waypoint order it is given.
    const ascend = [
      { x: 2, y: 2, floor: 0 },
      { x: 4, y: 2, floor: 0 },
      { x: 4, y: 4, floor: 1 },
    ];
    const descend = [...ascend].reverse();

    const traversal = new StairTraversal({
      waypoints: descend,
      floors: FLOORS,
      speed: SPEED,
      heightUnit: HEIGHT_UNIT,
    });

    const start = traversal.update(0);
    expect(start.x).toBe(4);
    expect(start.y).toBe(4);
    expect(start.worldY).toBeCloseTo(3, 10);

    const end = traversal.update(10); // far past total duration
    expect(end.x).toBe(2);
    expect(end.y).toBe(2);
    expect(end.worldY).toBeCloseTo(0, 10);
    expect(end.done).toBe(true);
  });
});

describe('StairTraversal (speed)', () => {
  it('a faster speed reaches the same progress point sooner', () => {
    const waypoints = [
      { x: 0, y: 0, floor: 0 },
      { x: 4, y: 0, floor: 0 },
    ];

    const slow = new StairTraversal({
      waypoints,
      floors: FLOORS,
      speed: 2,
      heightUnit: HEIGHT_UNIT,
    });
    const fast = new StairTraversal({
      waypoints,
      floors: FLOORS,
      speed: 8,
      heightUnit: HEIGHT_UNIT,
    });

    // Same dt (0.5s): slow (2 tiles/s) has covered 1 of 4 tiles (x=1); fast
    // (8 tiles/s) has already finished the whole 4-tile segment (done).
    const slowFrame = slow.update(0.5);
    const fastFrame = fast.update(0.5);

    expect(slowFrame.x).toBeCloseTo(1, 10);
    expect(slowFrame.done).toBe(false);
    expect(fastFrame.x).toBe(4);
    expect(fastFrame.done).toBe(true);
  });

  it('defaults to a speed of 4 tiles/second when omitted', () => {
    const traversal = new StairTraversal({
      waypoints: [
        { x: 0, y: 0, floor: 0 },
        { x: 4, y: 0, floor: 0 },
      ],
      floors: FLOORS,
      heightUnit: HEIGHT_UNIT,
    });

    // 4 tiles at the default 4 tiles/s -> exactly 1s to finish.
    const almostDone = traversal.update(0.99);
    expect(almostDone.done).toBe(false);
    const done = traversal.update(0.02);
    expect(done.done).toBe(true);
  });
});
