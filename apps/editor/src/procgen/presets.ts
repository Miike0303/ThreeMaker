/**
 * Named layout presets for Maker Studio procgen (Dungeon Alchemist–lite).
 * Pure data + resolver — no I/O.
 */

import type { StampRoomLightOptions } from './lights-from-stamp.js';

export type ProcgenPresetId = 'dungeon' | 'house' | 'cave';

/** Mood for room-center stamp lights (schema lowercase #rrggbb). */
export type ProcgenRoomLightStyle = {
  readonly color: string;
  readonly intensity: number;
  readonly range: number;
  readonly height: number;
};

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
  /** Room-center lamp mood when Generate places lights (WU-PROC-15). */
  readonly roomLight: ProcgenRoomLightStyle;
};

export const PROCGEN_PRESETS: readonly ProcgenPreset[] = [
  {
    id: 'dungeon',
    roomCount: 6,
    minRoomSize: 4,
    maxRoomSize: 8,
    corridorWidth: 1,
    tightBorder: false,
    // Warm torch amber.
    roomLight: { color: '#ffaa00', intensity: 1.2, range: 5, height: 2 },
  },
  {
    id: 'house',
    roomCount: 4,
    minRoomSize: 5,
    maxRoomSize: 9,
    corridorWidth: 2,
    tightBorder: true,
    // Soft warm white ceiling lamp.
    roomLight: { color: '#ffe8c8', intensity: 1.0, range: 6, height: 2.5 },
  },
  {
    id: 'cave',
    roomCount: 10,
    minRoomSize: 3,
    maxRoomSize: 6,
    corridorWidth: 1,
    tightBorder: false,
    // Cool dim bioluminescent glow.
    roomLight: { color: '#88ccff', intensity: 0.85, range: 4, height: 1.5 },
  },
] as const;

export function getProcgenPreset(id: ProcgenPresetId): ProcgenPreset {
  const found = PROCGEN_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown procgen preset: ${id}`);
  return found;
}

/** Map preset roomLight into stamp light options for apply. */
export function stampRoomLightOptionsFromPreset(preset: ProcgenPreset): StampRoomLightOptions {
  return {
    color: preset.roomLight.color,
    intensity: preset.roomLight.intensity,
    range: preset.roomLight.range,
    height: preset.roomLight.height,
  };
}

export const DEFAULT_PROCGEN_PRESET: ProcgenPresetId = 'dungeon';
