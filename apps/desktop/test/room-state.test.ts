import { describe, expect, it, vi } from 'vitest';
import {
  aboveFloorTilemap,
  createRoomTracker,
  driveRoomFade,
  resolveFadedRoomId,
} from '../src/room-state.js';

describe('createRoomTracker', () => {
  it('resolves a tile to its authored room ordinal', () => {
    const width = 3;
    // biome-ignore format: grid literal reads clearer un-wrapped
    const floor0 = new Uint16Array([
      0, 1, 1,
      0, 1, 1,
      0, 0, 0,
    ]);
    const tracker = createRoomTracker([floor0], width);

    expect(tracker.roomAt(0, 1, 0)).toBe(1);
    expect(tracker.roomAt(0, 2, 1)).toBe(1);
  });

  it('returns 0 for an unauthored cell (tile -> roomId 0)', () => {
    const width = 3;
    // biome-ignore format: grid literal reads clearer un-wrapped
    const floor0 = new Uint16Array([
      0, 1, 1,
      0, 1, 1,
      0, 0, 0,
    ]);
    const tracker = createRoomTracker([floor0], width);

    expect(tracker.roomAt(0, 0, 0)).toBe(0);
    expect(tracker.roomAt(0, 0, 2)).toBe(0);
  });

  it('returns 0 for a floor index with no grid at all (undefined entry)', () => {
    const width = 3;
    const floor0 = new Uint16Array([0, 1, 1, 0, 1, 1, 0, 0, 0]);
    const tracker = createRoomTracker([floor0, undefined], width);

    expect(tracker.roomAt(1, 1, 0)).toBe(0);
  });

  it('returns 0 for a floor index past the end of the grids array', () => {
    const width = 3;
    const floor0 = new Uint16Array([0, 1, 1, 0, 1, 1, 0, 0, 0]);
    const tracker = createRoomTracker([floor0], width);

    expect(tracker.roomAt(5, 1, 0)).toBe(0);
  });

  it('returns 0 for an out-of-bounds tile coordinate (negative x/y)', () => {
    const width = 3;
    const floor0 = new Uint16Array([0, 1, 1, 0, 1, 1, 0, 0, 0]);
    const tracker = createRoomTracker([floor0], width);

    expect(tracker.roomAt(0, -1, 0)).toBe(0);
    expect(tracker.roomAt(0, 0, -1)).toBe(0);
  });

  it('two floors are independent -- querying one never leaks into the other', () => {
    const width = 2;
    const floor0 = new Uint16Array([1, 1, 0, 0]);
    const floor1 = new Uint16Array([0, 0, 2, 2]);
    const tracker = createRoomTracker([floor0, floor1], width);

    expect(tracker.roomAt(0, 0, 0)).toBe(1);
    expect(tracker.roomAt(1, 0, 0)).toBe(0);
    expect(tracker.roomAt(1, 0, 1)).toBe(2);
    expect(tracker.roomAt(0, 0, 1)).toBe(0);
  });
});

describe('resolveFadedRoomId (camera-mode gate)', () => {
  it('hd2d resolves a positive room id as-is', () => {
    expect(resolveFadedRoomId('hd2d', 3)).toBe(3);
  });

  it('top-down resolves a positive room id as-is', () => {
    expect(resolveFadedRoomId('top-down', 3)).toBe(3);
  });

  it('hd2d/top-down resolve an unauthored (0) room id to null', () => {
    expect(resolveFadedRoomId('hd2d', 0)).toBeNull();
    expect(resolveFadedRoomId('top-down', 0)).toBeNull();
  });

  it('first-person ALWAYS resolves to null, even standing inside an authored room -- the player is under the ceiling and it must read as solid', () => {
    expect(resolveFadedRoomId('first-person', 7)).toBeNull();
    expect(resolveFadedRoomId('first-person', 0)).toBeNull();
  });
});

describe('aboveFloorTilemap (fade drives the floor ABOVE, not the current floor -- obs #117 gotcha)', () => {
  it('selects floorIndex + 1, not floorIndex itself', () => {
    const currentTilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };
    const aboveTilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };
    const floorSlots = [
      { render: { tilemap: currentTilemap } },
      { render: { tilemap: aboveTilemap } },
    ];

    expect(aboveFloorTilemap(floorSlots, 0)).toBe(aboveTilemap);
    expect(aboveFloorTilemap(floorSlots, 0)).not.toBe(currentTilemap);
  });

  it('returns undefined when there is no floor above (top floor / single-floor maps)', () => {
    const onlyTilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };
    const floorSlots = [{ render: { tilemap: onlyTilemap } }];

    expect(aboveFloorTilemap(floorSlots, 0)).toBeUndefined();
  });

  it('returns undefined when the floor above exists but is outside the render window (render undefined)', () => {
    const currentTilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };
    const floorSlots = [{ render: { tilemap: currentTilemap } }, { render: undefined }];

    expect(aboveFloorTilemap(floorSlots, 0)).toBeUndefined();
  });
});

describe('driveRoomFade', () => {
  it('calls setFadedRoom then updateFade on the given tilemap', () => {
    const tilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };

    driveRoomFade(tilemap, 4, 0.016);

    expect(tilemap.setFadedRoom).toHaveBeenCalledWith(4);
    expect(tilemap.updateFade).toHaveBeenCalledWith(0.016);
  });

  it('passes null straight through (used to force the ceiling back to opaque)', () => {
    const tilemap = { setFadedRoom: vi.fn(), updateFade: vi.fn() };

    driveRoomFade(tilemap, null, 0.016);

    expect(tilemap.setFadedRoom).toHaveBeenCalledWith(null);
  });

  it('is a no-op when there is no floor-above tilemap (no-floor-above -> no fade)', () => {
    expect(() => driveRoomFade(undefined, 4, 0.016)).not.toThrow();
  });
});
