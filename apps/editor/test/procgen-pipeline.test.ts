/**
 * Regression: full Maker Studio procgen path (stamp → apply → playable doc).
 * Catches accidental breaks across spawn, doors, and semantic tagging.
 */
import { describe, expect, it } from 'vitest';
import { createBlankMapDocument } from '../src/map-compose.js';
import { applyDungeonStampToMapDocument } from '../src/procgen/apply-stamp.js';
import { pickMainRoomSpawn, stampSimpleDungeon } from '../src/procgen/dungeon-stamp.js';
import { resolveDungeonTileIds } from '../src/procgen/tile-pick.js';

const GROUND = 2816;
const WALL = 4352;
const DOOR = 5001;

describe('procgen pipeline regression', () => {
  it('house preset: resolve tiles → stamp doors → apply spawn+semantics', () => {
    const resolved = resolveDungeonTileIds({
      fillTileId: GROUND,
      groundLayer: [],
      wallLayer: [],
      fallbackGround: GROUND,
      fallbackWall: WALL,
      doorTileOverride: DOOR,
      semantics: { [String(WALL)]: { class: 'wall' } },
    });
    expect(resolved.groundTileId).toBe(GROUND);
    expect(resolved.wallTileId).toBe(WALL);
    expect(resolved.doorTileId).toBe(DOOR);

    const stamp = stampSimpleDungeon({
      width: 32,
      height: 24,
      seed: 20260808,
      groundTileId: resolved.groundTileId,
      wallTileId: resolved.wallTileId,
      doorTileId: resolved.doorTileId,
      roomCount: 4,
      minRoomSize: 5,
      maxRoomSize: 9,
      corridorWidth: 2,
      tightBorder: true,
    });

    expect(stamp.rooms.length).toBeGreaterThan(0);
    expect(stamp.doors.length).toBeGreaterThan(0);
    for (const d of stamp.doors) {
      const i = d.y * 32 + d.x;
      expect(stamp.layers[0][i]).toBe(GROUND);
      expect(stamp.layers[1][i]).toBe(DOOR);
      expect(stamp.layers[2][i]).toBe(0);
    }

    const base = createBlankMapDocument({
      id: 'pipeline-house',
      name: 'Pipeline',
      width: 32,
      height: 24,
      slots: {},
      flags: new Array(8192).fill(0),
    });
    const withNarrative = {
      ...base,
      events: {
        talk: [{ type: 'showDialogue' as const, source: { kind: 'text' as const, lines: ['hi'] } }],
      },
      worldSeeds: { intro: true },
    };

    const next = applyDungeonStampToMapDocument(withNarrative, stamp, {
      placeSpawnInMainRoom: true,
    });

    const spawnPos = pickMainRoomSpawn(stamp.rooms, 32, 24);
    expect(next.spawn).toEqual({ x: spawnPos.x, y: spawnPos.y, floor: 'floor-0' });
    expect(next.events).toEqual(withNarrative.events);
    expect(next.worldSeeds).toEqual(withNarrative.worldSeeds);
    expect(next.tileset.semantics[String(WALL)]).toEqual({ class: 'wall' });
    expect(next.tileset.semantics[String(DOOR)]).toEqual({ class: 'door' });

    const si = spawnPos.y * 32 + spawnPos.x;
    expect(next.floors[0]?.layers.tiles[0]?.[si]).toBe(GROUND);
    expect(next.floors[0]?.layers.tiles[2]?.[si]).toBe(0);
  });

  it('is deterministic end-to-end for the same seed', () => {
    const opts = {
      width: 28,
      height: 20,
      seed: 11,
      groundTileId: GROUND,
      wallTileId: WALL,
      doorTileId: DOOR,
      roomCount: 5,
    } as const;
    const a = stampSimpleDungeon(opts);
    const b = stampSimpleDungeon(opts);
    expect(a.layers).toEqual(b.layers);
    expect(a.doors).toEqual(b.doors);
    expect(a.rooms).toEqual(b.rooms);
  });
});
