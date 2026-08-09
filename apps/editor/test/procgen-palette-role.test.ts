import { describe, expect, it } from 'vitest';
import {
  assignmentFromPaletteClick,
  PROCGEN_PALETTE_ROLES,
  selectedTileIdForRole,
  statusForPaletteAssignment,
} from '../src/procgen/palette-role.js';

describe('assignmentFromPaletteClick', () => {
  it('assigns fill for brush role', () => {
    expect(assignmentFromPaletteClick('brush', 99)).toEqual({ setFill: 99 });
  });

  it('assigns wall and door overrides', () => {
    expect(assignmentFromPaletteClick('wall', 4352)).toEqual({ setWallOverride: 4352 });
    expect(assignmentFromPaletteClick('door', 5001)).toEqual({ setDoorOverride: 5001 });
  });

  it('ignores zero and negative tile ids', () => {
    expect(assignmentFromPaletteClick('brush', 0)).toEqual({});
    expect(assignmentFromPaletteClick('wall', -3)).toEqual({});
    expect(assignmentFromPaletteClick('door', Number.NaN)).toEqual({});
  });

  it('floors fractional ids', () => {
    expect(assignmentFromPaletteClick('brush', 12.9)).toEqual({ setFill: 12 });
  });
});

describe('selectedTileIdForRole', () => {
  const state = { fillTileId: 10, wallOverride: 20, doorOverride: 30 };

  it('returns the matching override per role', () => {
    expect(selectedTileIdForRole('brush', state)).toBe(10);
    expect(selectedTileIdForRole('wall', state)).toBe(20);
    expect(selectedTileIdForRole('door', state)).toBe(30);
  });

  it('returns 0 when override is auto (zero)', () => {
    expect(
      selectedTileIdForRole('wall', { fillTileId: 1, wallOverride: 0, doorOverride: 5 }),
    ).toBe(0);
  });
});

describe('PROCGEN_PALETTE_ROLES', () => {
  it('lists brush, wall, door in UI order', () => {
    expect(PROCGEN_PALETTE_ROLES).toEqual(['brush', 'wall', 'door']);
  });
});

describe('statusForPaletteAssignment', () => {
  it('returns undefined for empty assignment', () => {
    expect(statusForPaletteAssignment({})).toBeUndefined();
  });

  it('prefers fill, then wall, then door message keys', () => {
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
  });
});
