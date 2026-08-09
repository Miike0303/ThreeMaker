/**
 * Palette-dock roles for Maker Studio procgen tile picking.
 * Pure: clicking a catalog swatch assigns brush fill, wall/door/furniture override.
 */

export type ProcgenPaletteRole = 'brush' | 'wall' | 'door' | 'furniture';

export const PROCGEN_PALETTE_ROLES: readonly ProcgenPaletteRole[] = [
  'brush',
  'wall',
  'door',
  'furniture',
] as const;

export type PaletteTileAssignment = {
  /** When set, becomes the paint brush / ground fill tile. */
  readonly setFill?: number;
  /** When set, becomes the explicit wall tile override (0 means auto — never returned). */
  readonly setWallOverride?: number;
  /** When set, becomes the explicit door tile override (0 means auto — never returned). */
  readonly setDoorOverride?: number;
  /** When set, becomes the explicit furniture tile override (0 means auto — never returned). */
  readonly setFurnitureOverride?: number;
};

/**
 * Map a palette click to the active role. Ignores non-positive tile ids.
 * Wall/door/furniture assignments never return 0 (auto is chosen via separate UI).
 */
export function assignmentFromPaletteClick(
  role: ProcgenPaletteRole,
  tileId: number,
): PaletteTileAssignment {
  if (!Number.isFinite(tileId) || tileId <= 0) {
    return {};
  }
  const id = Math.floor(tileId);
  switch (role) {
    case 'brush':
      return { setFill: id };
    case 'wall':
      return { setWallOverride: id };
    case 'door':
      return { setDoorOverride: id };
    case 'furniture':
      return { setFurnitureOverride: id };
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/** Which tile id the palette should highlight for the active role. */
export function selectedTileIdForRole(
  role: ProcgenPaletteRole,
  state: {
    readonly fillTileId: number;
    readonly wallOverride: number;
    readonly doorOverride: number;
    readonly furnitureOverride: number;
  },
): number {
  switch (role) {
    case 'brush':
      return state.fillTileId > 0 ? state.fillTileId : 0;
    case 'wall':
      return state.wallOverride > 0 ? state.wallOverride : 0;
    case 'door':
      return state.doorOverride > 0 ? state.doorOverride : 0;
    case 'furniture':
      return state.furnitureOverride > 0 ? state.furnitureOverride : 0;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export type PaletteAssignmentStatus = {
  /** Locale key under painter.palette.* (uses `{id}` template). */
  readonly messageKey: string;
  readonly id: number;
};

/**
 * Status toast payload after a successful palette assignment.
 * Returns undefined when the assignment was empty (ignored click).
 */
export function statusForPaletteAssignment(
  assignment: PaletteTileAssignment,
): PaletteAssignmentStatus | undefined {
  if (assignment.setFill !== undefined) {
    return { messageKey: 'painter.palette.assigned.brush', id: assignment.setFill };
  }
  if (assignment.setWallOverride !== undefined) {
    return { messageKey: 'painter.palette.assigned.wall', id: assignment.setWallOverride };
  }
  if (assignment.setDoorOverride !== undefined) {
    return { messageKey: 'painter.palette.assigned.door', id: assignment.setDoorOverride };
  }
  if (assignment.setFurnitureOverride !== undefined) {
    return {
      messageKey: 'painter.palette.assigned.furniture',
      id: assignment.setFurnitureOverride,
    };
  }
  return undefined;
}
