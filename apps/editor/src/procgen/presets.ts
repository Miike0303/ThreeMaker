/**
 * Named layout presets for Maker Studio procgen (Dungeon Alchemist–lite).
 * Pure data + resolver — no I/O.
 */

export type ProcgenPresetId = 'dungeon' | 'house' | 'cave';

export type ProcgenPreset = {
  readonly id: ProcgenPresetId;
  readonly roomCount: number;
  readonly minRoomSize: number;
  readonly maxRoomSize: number;
  /** Corridor thickness in tiles (1 = classic dungeon, 2 = house hall). */
  readonly corridorWidth: number;
  /**
   * When true, leave a solid ring of uncarved cells at the map border
   * (house exterior walls feel tighter).
   */
  readonly tightBorder: boolean;
};

export const PROCGEN_PRESETS: readonly ProcgenPreset[] = [
  {
    id: 'dungeon',
    roomCount: 6,
    minRoomSize: 4,
    maxRoomSize: 8,
    corridorWidth: 1,
    tightBorder: false,
  },
  {
    id: 'house',
    roomCount: 4,
    minRoomSize: 5,
    maxRoomSize: 9,
    corridorWidth: 2,
    tightBorder: true,
  },
  {
    id: 'cave',
    roomCount: 10,
    minRoomSize: 3,
    maxRoomSize: 6,
    corridorWidth: 1,
    tightBorder: false,
  },
] as const;

export function getProcgenPreset(id: ProcgenPresetId): ProcgenPreset {
  const found = PROCGEN_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown procgen preset: ${id}`);
  return found;
}

export const DEFAULT_PROCGEN_PRESET: ProcgenPresetId = 'dungeon';
