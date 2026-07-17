import { describe, expect, it } from 'vitest';
import { ElevationField } from '../src/elevation-field.js';
import { PassabilityGrid } from '../src/passability-grid.js';
import { buildMap, buildTileset } from './fixtures.js';

// Raw flag bits, mirroring importer-rpgm's tile-flags.ts (kept as plain
// numbers here so this test doesn't depend on that module's internals,
// only its documented bit layout).
const IMPASSABLE_DOWN = 0x1;
const IMPASSABLE_LEFT = 0x2;
const IMPASSABLE_RIGHT = 0x4;
const IMPASSABLE_UP = 0x8;
const STAR_UPPER_LAYER = 0x10;

describe('PassabilityGrid (synthetic maps)', () => {
  it('allows movement everywhere on a fully open floor', () => {
    const layer0 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(1, 1, 'up')).toBe(true);
    expect(grid.canMove(1, 1, 'down')).toBe(true);
    expect(grid.canMove(1, 1, 'left')).toBe(true);
    expect(grid.canMove(1, 1, 'right')).toBe(true);
  });

  it('blocks out-of-bounds movement regardless of flags', () => {
    const layer0 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'left')).toBe(false);
    expect(grid.canMove(0, 0, 'up')).toBe(false);
    expect(grid.canMove(2, 2, 'right')).toBe(false);
    expect(grid.canMove(2, 2, 'down')).toBe(false);
  });

  it('blocks leaving a tile in the direction its own directional bit forbids', () => {
    // 3x1 row: tile (0,0) has its right side sealed.
    const layer0 = [2, 1, 1];
    const map = buildMap(3, 1, { 0: layer0 });
    const tileset = buildTileset({ 1: 0, 2: IMPASSABLE_RIGHT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(false);
  });

  it('blocks entering a tile from the side its own directional bit forbids, even if the source tile allows leaving', () => {
    // 4x1 row: tile (2,0) cannot be entered from the left (moving right into it).
    const layer0 = [1, 1, 5, 1];
    const map = buildMap(4, 1, { 0: layer0 });
    const tileset = buildTileset({ 1: 0, 5: IMPASSABLE_LEFT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(1, 0, 'right')).toBe(false);
    // Leaving (2,0) rightward is unaffected by its impassableLeft bit.
    expect(grid.canMove(2, 0, 'right')).toBe(true);
  });

  it('ignores the star (upper-layer) bit and keeps looking at layers below it', () => {
    // Layer 3 (top) at (0,0) is star-flagged and would otherwise block
    // right movement, but must be skipped; layer 0 below is open.
    const layer0 = [1, 1, 1, 1];
    const layer3 = [6, 0, 0, 0];
    const map = buildMap(2, 2, { 0: layer0, 3: layer3 });
    const tileset = buildTileset({ 1: 0, 6: STAR_UPPER_LAYER | IMPASSABLE_RIGHT });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(true);
  });

  it('blocks every direction for an all-direction-impassable tile', () => {
    const layer0 = [1, 1, 1, 7, 1, 1, 1, 1, 1];
    const map = buildMap(3, 3, { 0: layer0 });
    const tileset = buildTileset({
      1: 0,
      7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
    });
    const grid = new PassabilityGrid(map, tileset);

    // Tile 7 sits at index 3 -> (x=0, y=1) in a 3-wide grid.
    expect(grid.canMove(0, 1, 'up')).toBe(false);
    expect(grid.canMove(0, 1, 'down')).toBe(false);
    expect(grid.canMove(0, 1, 'right')).toBe(false);
    // Neighbor (1,1) moving into the blocked tile is also refused.
    expect(grid.canMove(1, 1, 'left')).toBe(false);
  });

  it('treats a tile with no tile on any layer as open', () => {
    // All layers default to zero (empty) for this map -- no overrides.
    const map = buildMap(2, 2);
    const tileset = buildTileset({});
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(true);
    expect(grid.canMove(0, 0, 'down')).toBe(true);
  });

  it('isStandable is false only when a tile is blocked from every direction at once', () => {
    const layer0 = [1, 2, 7];
    const map = buildMap(3, 1, { 0: layer0 });
    const tileset = buildTileset({
      1: 0,
      2: IMPASSABLE_RIGHT,
      7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
    });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.isStandable(0, 0)).toBe(true); // fully open
    expect(grid.isStandable(1, 0)).toBe(true); // partially blocked, still standable
    expect(grid.isStandable(2, 0)).toBe(false); // fully sealed
    expect(grid.isStandable(-1, 0)).toBe(false); // out of bounds
  });

  describe('isGoodSpawnCandidate (spawn-quality bug fix)', () => {
    it('returns true for an ordinary open tile with an open neighbor', () => {
      const layer0 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
      const map = buildMap(3, 3, { 0: layer0 });
      const tileset = buildTileset({ 1: 0 });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.isGoodSpawnCandidate(1, 1)).toBe(true);
    });

    it('returns false for a tile standable by its own flags (0x0) but fully enclosed by neighbors that block every entry (real bug: "spawns in a wall")', () => {
      // Center tile (1,1) has flags 0 (fully open by its own bits), but is
      // ringed by tiles flagged impassable from every direction -- the
      // exact pattern the reported bug describes: a spawn candidate that
      // LOOKS standable (isStandable true) yet has no usable exit at all.
      // biome-ignore format: grid literal reads clearer un-wrapped
      const layer0 = [
        7, 7, 7,
        7, 1, 7,
        7, 7, 7,
      ];
      const map = buildMap(3, 3, { 0: layer0 });
      const tileset = buildTileset({
        1: 0,
        7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
      });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.isStandable(1, 1)).toBe(true); // the pre-existing (insufficient) check would accept this
      expect(grid.isGoodSpawnCandidate(1, 1)).toBe(false);
    });

    it('returns false for a tile fully sealed by its own flags (isStandable already false)', () => {
      const layer0 = [1, 1, 1, 1, 7, 1, 1, 1, 1];
      const map = buildMap(3, 3, { 0: layer0 });
      const tileset = buildTileset({
        1: 0,
        7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
      });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.isGoodSpawnCandidate(1, 1)).toBe(false);
    });

    it('returns false at a map corner/edge with no standable neighbor in bounds (real bug: "reads as outside")', () => {
      // (0,0) is open by its own flags, but both its in-bounds neighbors
      // are walls and the other two directions are off the map entirely.
      const layer0 = [1, 7, 7, 1];
      const map = buildMap(2, 2, { 0: layer0 });
      const tileset = buildTileset({
        1: 0,
        7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
      });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.isStandable(0, 0)).toBe(true);
      expect(grid.isGoodSpawnCandidate(0, 0)).toBe(false);
    });

    it('returns true when at least one direction has BOTH a passable exit and a standable neighbor, even if other directions are blocked', () => {
      // (1,1) can only leave rightward; (2,1) is open. Every other neighbor
      // is either blocked-from-(1,1) or itself unstandable.
      // biome-ignore format: grid literal reads clearer un-wrapped
      const layer0 = [
        7, 7, 7,
        7, 8, 1,
        7, 7, 7,
      ];
      const map = buildMap(3, 3, { 0: layer0 });
      const tileset = buildTileset({
        1: 0,
        7: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_RIGHT | IMPASSABLE_UP,
        8: IMPASSABLE_DOWN | IMPASSABLE_LEFT | IMPASSABLE_UP, // only rightward is open
      });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.isGoodSpawnCandidate(1, 1)).toBe(true);
    });

    it('a successful canMove into a neighbor always implies that neighbor is standable (no separate neighbor check needed)', () => {
      // Documents the invariant isGoodSpawnCandidate relies on: entering a
      // tile requires at least one of ITS OWN 4 bits (the one blocking
      // entry from this side) to be unset, which is exactly what
      // `isStandable` itself checks ("not all 4 set") -- so a passable
      // neighbor can never simultaneously be `isStandable() === false`.
      const layer0 = [1, 1];
      const map = buildMap(2, 1, { 0: layer0 });
      const tileset = buildTileset({ 1: 0 });
      const grid = new PassabilityGrid(map, tileset);

      expect(grid.canMove(0, 0, 'right')).toBe(true);
      expect(grid.isStandable(1, 0)).toBe(true);
    });
  });
});

describe('PassabilityGrid elevation (region-derived height)', () => {
  it('exposes elevationAt matching the region layer, per the MV3D region-N-is-height-N convention', () => {
    const layer0 = new Array(3).fill(1);
    const regions = [0, 3, 8]; // ground, height 3, out-of-range region (also ground)
    const map = buildMap(3, 1, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.elevationAt(0, 0)).toBe(0);
    expect(grid.elevationAt(1, 0)).toBe(3);
    expect(grid.elevationAt(2, 0)).toBe(0);
    expect(grid.elevationAt(-1, 0)).toBe(0); // out of bounds
  });

  it('blocks a step between tiles at different elevations, even with no other passage flags set', () => {
    const layer0 = new Array(2).fill(1);
    const regions = [0, 1]; // (0,0) ground, (1,0) height 1
    const map = buildMap(2, 1, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(false);
    expect(grid.canMove(1, 0, 'left')).toBe(false);
  });

  it('allows a step between tiles at the same elevation, even both nonzero', () => {
    const layer0 = new Array(2).fill(1);
    const regions = [2, 2];
    const map = buildMap(2, 1, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0 });
    const grid = new PassabilityGrid(map, tileset);

    expect(grid.canMove(0, 0, 'right')).toBe(true);
    expect(grid.canMove(1, 0, 'left')).toBe(true);
  });
});

describe('PassabilityGrid ramp crossing (edge-profile rule)', () => {
  // Shared 3x3 fixture: center (1,1) height 1, explicit rampDirection
  // override 'west' toward (0,1) height 0 (override sidesteps any tie-break
  // ambiguity from off-map/neighbor heights, per importer-rpgm's documented
  // "explicit override wins" precedence). North neighbor (1,0) sits at an
  // unrelated height (3) to prove wrong-side entry stays blocked; south/east
  // sit at the ramp cell's OWN height (1) to exercise the perpendicular
  // same-height rule.
  //
  //   (0,0)=1  (1,0)=3  (2,0)=1
  //   (0,1)=0  (1,1)=1  (2,1)=1   <- ramp cell (1,1), rampDirection 'west'
  //   (0,2)=1  (1,2)=1  (2,2)=1
  function buildRampFixture() {
    const layer0 = new Array(9).fill(1);
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      1, 3, 1,
      0, 1, 1,
      1, 1, 1,
    ];
    const map = buildMap(3, 3, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0 });
    const elevation = new ElevationField(map, [{ x: 1, y: 1, rampDirection: 'west' as const }]);
    return new PassabilityGrid(map, tileset, elevation);
  }

  it('opens the authorized crossing in both directions (ascend and descend)', () => {
    const grid = buildRampFixture();

    expect(grid.canMove(1, 1, 'left')).toBe(true); // descend ramp -> ground
    expect(grid.canMove(0, 1, 'right')).toBe(true); // ascend ground -> ramp
  });

  it('still blocks a non-ramp cliff step (cliff invariant holds)', () => {
    const grid = buildRampFixture();

    // (1,1) height 1 vs (1,0) height 3: a real cliff, no ramp authorizes it.
    expect(grid.canMove(1, 1, 'up')).toBe(false);
    expect(grid.canMove(1, 0, 'down')).toBe(false);
  });

  it('blocks wrong-side entry: a same-height-looking step through the ramp cell that is not its authorized edge', () => {
    const grid = buildRampFixture();

    // (1,1) and (1,0) are NOT connected by the ramp (its direction is west,
    // not north) -- this is the same assertion as the cliff-invariant test
    // above, restated as "wrong side" per spec: the ramp authorizes exactly
    // one crossing, nothing else opens just because the ramp exists nearby.
    expect(grid.canMove(1, 1, 'up')).toBe(false);
  });

  it('blocks perpendicular same-height entry onto a mid-slope ramp', () => {
    const grid = buildRampFixture();

    // (2,1) is flat height 1 -- the SAME own-height as the ramp cell (1,1)
    // -- but the ramp's east edge (opposite the downhill west edge) is the
    // flat, non-sloped side, so this step IS allowed (matches design: "the
    // opposite edge = H", coplanar with a flat same-height neighbor).
    expect(grid.canMove(1, 1, 'right')).toBe(true);
    expect(grid.canMove(2, 1, 'left')).toBe(true);

    // (1,2) is flat height 1 too, but sits across the ramp's SOUTH edge --
    // a perpendicular edge that slopes linearly (H..H-1) on the ramp cell's
    // side while the flat neighbor's edge is constant H. Profiles disagree
    // -> blocked, even though both cells report the same own-height.
    expect(grid.canMove(1, 1, 'down')).toBe(false);
    expect(grid.canMove(1, 2, 'up')).toBe(false);
  });

  it('allows sideways movement between two identically-directed parallel ramps (wide stairs)', () => {
    const layer0 = new Array(6).fill(1);
    // 3x2 grid: two side-by-side ramp cells at (1,0) and (1,1), both height 1,
    // both explicitly overridden to ramp west toward (0,*) height 0.
    const regions = [0, 1, 1, 0, 1, 1];
    const map = buildMap(3, 2, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0 });
    const elevation = new ElevationField(map, [
      { x: 1, y: 0, rampDirection: 'west' as const },
      { x: 1, y: 1, rampDirection: 'west' as const },
    ]);
    const grid = new PassabilityGrid(map, tileset, elevation);

    expect(grid.canMove(1, 0, 'down')).toBe(true);
    expect(grid.canMove(1, 1, 'up')).toBe(true);
  });

  it('regression: canMove on a flat+cliff map with NO ramp cells matches documented pre-ramp behavior across a representative matrix (default ElevationField, no elevation param)', () => {
    // 3x2 grid, tile id 1 = fully open, tile id 2 = open but sealed rightward
    // (a flag block, independent of elevation).
    //   (0,0)=1  (1,0)=1  (2,0)=1     heights: 2  2  6
    //   (0,1)=2  (1,1)=1  (2,1)=1     heights: 2  2  2
    const layer0 = [1, 1, 1, 2, 1, 1];
    // biome-ignore format: grid literal reads clearer un-wrapped
    const regions = [
      2, 2, 6,
      2, 2, 2,
    ];
    const map = buildMap(3, 2, { 0: layer0 }, regions);
    const tileset = buildTileset({ 1: 0, 2: IMPASSABLE_RIGHT });
    const grid = new PassabilityGrid(map, tileset); // no elevation param at all

    // Same-height adjacent: allowed, both directions.
    expect(grid.canMove(0, 0, 'right')).toBe(true);
    expect(grid.canMove(1, 0, 'left')).toBe(true);

    // Cliff up / cliff down across the same edge: blocked both ways.
    expect(grid.canMove(1, 0, 'right')).toBe(false); // height 2 -> 6, ascend blocked
    expect(grid.canMove(2, 0, 'left')).toBe(false); // height 6 -> 2, descend blocked

    // Out of bounds: blocked regardless of flags/elevation.
    expect(grid.canMove(0, 0, 'left')).toBe(false);
    expect(grid.canMove(0, 0, 'up')).toBe(false);
    expect(grid.canMove(2, 1, 'right')).toBe(false);
    expect(grid.canMove(2, 1, 'down')).toBe(false);

    // Flag-blocked but same height: elevation agrees (both height 2), yet
    // the tile's own directional flag still blocks the step -- proves the
    // edge-profile rule doesn't override or short-circuit flag checks.
    expect(grid.canMove(0, 1, 'right')).toBe(false);
  });
});
