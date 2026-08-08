import { describe, expect, it } from 'vitest';
import { stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';
import {
  DEFAULT_PROCGEN_PRESET,
  getProcgenPreset,
  PROCGEN_PRESETS,
  type ProcgenPresetId,
} from '../src/procgen/presets.js';

const GROUND = 2816;
const WALL = 4352;

describe('procgen presets', () => {
  it('lists dungeon, house, and cave', () => {
    expect(PROCGEN_PRESETS.map((p) => p.id)).toEqual(['dungeon', 'house', 'cave']);
    expect(DEFAULT_PROCGEN_PRESET).toBe('dungeon');
  });

  it('getProcgenPreset returns each id', () => {
    for (const id of ['dungeon', 'house', 'cave'] as const) {
      expect(getProcgenPreset(id).id).toBe(id);
    }
  });

  it('each preset stamps a deterministic non-empty layout', () => {
    const ids: ProcgenPresetId[] = ['dungeon', 'house', 'cave'];
    for (const id of ids) {
      const preset = getProcgenPreset(id);
      const stamp = stampSimpleDungeon({
        width: 24,
        height: 20,
        seed: 12345,
        groundTileId: GROUND,
        wallTileId: WALL,
        roomCount: preset.roomCount,
        minRoomSize: preset.minRoomSize,
        maxRoomSize: preset.maxRoomSize,
        corridorWidth: preset.corridorWidth,
        tightBorder: preset.tightBorder,
      });
      expect(stamp.layers[0].some((t) => t === GROUND)).toBe(true);
      expect(stamp.layers[2].some((t) => t === WALL)).toBe(true);
      const again = stampSimpleDungeon({
        width: 24,
        height: 20,
        seed: 12345,
        groundTileId: GROUND,
        wallTileId: WALL,
        roomCount: preset.roomCount,
        minRoomSize: preset.minRoomSize,
        maxRoomSize: preset.maxRoomSize,
        corridorWidth: preset.corridorWidth,
        tightBorder: preset.tightBorder,
      });
      expect(again.layers[0]).toEqual(stamp.layers[0]);
    }
  });

  it('house uses wider corridors than dungeon for the same seed/rooms', () => {
    // Same seed/room sizes, only corridorWidth differs → house walkable count >= dungeon.
    const base = {
      width: 28,
      height: 22,
      seed: 77,
      groundTileId: GROUND,
      wallTileId: WALL,
      roomCount: 4,
      minRoomSize: 5,
      maxRoomSize: 8,
    };
    const narrow = stampSimpleDungeon({ ...base, corridorWidth: 1 });
    const wide = stampSimpleDungeon({ ...base, corridorWidth: 2 });
    const count = (layers: readonly [number[], number[], number[], number[]]) =>
      layers[0].filter((id) => id === GROUND).length;
    expect(count(wide.layers)).toBeGreaterThanOrEqual(count(narrow.layers));
  });
});
