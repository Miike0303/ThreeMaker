import { describe, expect, it } from 'vitest';
import {
  assignmentFromPaletteClick,
  PROCGEN_PALETTE_ROLES,
  selectedTileIdForRole,
  statusForPaletteAssignment,
} from '../src/procgen/palette-role.js';

describe('assignmentFromPaletteClick', () => {
  it('assigns tile ID one to every palette role', () => {
    expect(PROCGEN_PALETTE_ROLES.map((role) => assignmentFromPaletteClick(role, 1))).toEqual([
      { setFill: 1 },
      { setWallOverride: 1 },
      { setDoorOverride: 1 },
      { setFurnitureOverride: 1 },
    ]);
  });

  it('assigns fill for brush role', () => {
    expect(assignmentFromPaletteClick('brush', 99)).toEqual({ setFill: 99 });
  });

  it('assigns wall, door, and furniture overrides', () => {
    expect(assignmentFromPaletteClick('wall', 4352)).toEqual({ setWallOverride: 4352 });
    expect(assignmentFromPaletteClick('door', 5001)).toEqual({ setDoorOverride: 5001 });
    expect(assignmentFromPaletteClick('furniture', 9001)).toEqual({
      setFurnitureOverride: 9001,
    });
  });

  it('ignores zero and negative tile ids', () => {
    expect(assignmentFromPaletteClick('brush', 0)).toEqual({});
    expect(assignmentFromPaletteClick('wall', -3)).toEqual({});
    expect(assignmentFromPaletteClick('door', Number.NaN)).toEqual({});
    expect(assignmentFromPaletteClick('furniture', 0)).toEqual({});
  });

  it('floors fractional ids', () => {
    expect(assignmentFromPaletteClick('brush', 12.9)).toEqual({ setFill: 12 });
    expect(assignmentFromPaletteClick('furniture', 8.2)).toEqual({ setFurnitureOverride: 8 });
  });
});

describe('selectedTileIdForRole', () => {
  it('highlights tile ID one for the door role', () => {
    expect(
      selectedTileIdForRole('door', {
        fillTileId: 10,
        wallOverride: 20,
        doorOverride: 1,
        furnitureOverride: 40,
      }),
    ).toBe(1);
  });

  it('highlights tile ID one for the furniture role', () => {
    expect(
      selectedTileIdForRole('furniture', {
        fillTileId: 10,
        wallOverride: 20,
        doorOverride: 30,
        furnitureOverride: 1,
      }),
    ).toBe(1);
  });

  it('highlights tile ID one for the brush role', () => {
    expect(
      selectedTileIdForRole('brush', {
        fillTileId: 1,
        wallOverride: 20,
        doorOverride: 30,
        furnitureOverride: 40,
      }),
    ).toBe(1);
  });

  it('clears the furniture highlight for a negative furniture override', () => {
    expect(
      selectedTileIdForRole('furniture', {
        fillTileId: 10,
        wallOverride: 20,
        doorOverride: 30,
        furnitureOverride: -1,
      }),
    ).toBe(0);
  });

  it('clears the door highlight for a negative door override', () => {
    expect(
      selectedTileIdForRole('door', {
        fillTileId: 10,
        wallOverride: 20,
        doorOverride: -1,
        furnitureOverride: 40,
      }),
    ).toBe(0);
  });

  const state = {
    fillTileId: 10,
    wallOverride: 20,
    doorOverride: 30,
    furnitureOverride: 40,
  };

  it('returns the matching override per role', () => {
    expect(selectedTileIdForRole('brush', state)).toBe(10);
    expect(selectedTileIdForRole('wall', state)).toBe(20);
    expect(selectedTileIdForRole('door', state)).toBe(30);
    expect(selectedTileIdForRole('furniture', state)).toBe(40);
  });

  it('clears the brush highlight for a negative fill tile', () => {
    expect(selectedTileIdForRole('brush', { ...state, fillTileId: -1 })).toBe(0);
  });

  it('clears the wall highlight for a negative wall override', () => {
    expect(selectedTileIdForRole('wall', { ...state, wallOverride: -1 })).toBe(0);
  });

  it('returns 0 when override is auto (zero)', () => {
    expect(
      selectedTileIdForRole('furniture', {
        fillTileId: 1,
        wallOverride: 0,
        doorOverride: 5,
        furnitureOverride: 0,
      }),
    ).toBe(0);
  });

  it('highlights tile id 1 when selected as the wall override', () => {
    expect(
      selectedTileIdForRole('wall', {
        fillTileId: 10,
        wallOverride: 1,
        doorOverride: 30,
        furnitureOverride: 40,
      }),
    ).toBe(1);
  });
});

describe('PROCGEN_PALETTE_ROLES', () => {
  it('lists brush, wall, door, furniture in UI order', () => {
    expect(PROCGEN_PALETTE_ROLES).toEqual(['brush', 'wall', 'door', 'furniture']);
  });
});

describe('statusForPaletteAssignment', () => {
  it('returns undefined for empty assignment', () => {
    expect(statusForPaletteAssignment({})).toBeUndefined();
  });

  it('prefers fill, then wall, door, furniture message keys', () => {
    expect(statusForPaletteAssignment({ setFill: 9 })).toEqual({
      messageKey: 'painter.palette.assigned.brush',
      id: 9,
    });
    expect(statusForPaletteAssignment({ setWallOverride: 11 })).toEqual({
      messageKey: 'painter.palette.assigned.wall',
      id: 11,
    });
    expect(statusForPaletteAssignment({ setDoorOverride: 13 })).toEqual({
      messageKey: 'painter.palette.assigned.door',
      id: 13,
    });
    expect(statusForPaletteAssignment({ setFurnitureOverride: 15 })).toEqual({
      messageKey: 'painter.palette.assigned.furniture',
      id: 15,
    });
  });
});
