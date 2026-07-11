import { describe, expect, it } from 'vitest';
import { ChunkStreamer, chunkKey } from '../src/streaming/chunk-streamer.js';

/** 512x512-tile map, 16-tile chunks -> a 32x32 chunk grid. */
const GIANT = { chunkSize: 16, mapWidth: 512, mapHeight: 512 } as const;

describe('chunkKey', () => {
  it('matches the "{chunkX},{chunkY}" format buildChunks sorts by', () => {
    expect(chunkKey(3, 7)).toBe('3,7');
  });
});

describe('ChunkStreamer', () => {
  it('rejects a non-positive chunk size', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: 0 })).toThrow(/chunkSize/);
  });

  it('rejects a negative build radius', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: -1 })).toThrow(/buildRadius/);
  });

  it('rejects a dispose radius smaller than the build radius (hysteresis inverted)', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 3, disposeRadius: 2 })).toThrow(
      /disposeRadius/,
    );
  });

  it('first update builds the full (2r+1)^2 square around a mid-map focus', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });

    // Tile (256, 256) -> chunk (16, 16).
    const diff = streamer.update(256, 256);

    expect(diff.toBuild).toHaveLength(25);
    expect(diff.toDispose).toHaveLength(0);
    expect(diff.toBuild).toContain('16,16');
    expect(diff.toBuild).toContain('14,14');
    expect(diff.toBuild).toContain('18,18');
    expect(streamer.liveCount).toBe(25);
  });

  it('clips the wanted square to the map chunk grid at a corner focus', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });

    const diff = streamer.update(0, 0);

    // Chunk (0,0): only the 3x3 quadrant inside the map exists.
    expect(diff.toBuild).toHaveLength(9);
    expect(diff.toBuild).toContain('0,0');
    expect(diff.toBuild).toContain('2,2');
    expect(diff.toBuild).not.toContain('-1,0');
  });

  it('clamps an out-of-bounds focus tile to the map edge', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 1 });

    const diff = streamer.update(-40, 100000);

    // Clamped to tile (0, 511) -> chunk (0, 31): a 2x2 corner square.
    expect(diff.toBuild.sort()).toEqual(['0,30', '0,31', '1,30', '1,31']);
  });

  it('returns an empty diff while the focus stays inside the same chunk', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });
    streamer.update(256, 256);

    const diff = streamer.update(257, 258); // still chunk (16, 16)

    expect(diff.toBuild).toHaveLength(0);
    expect(diff.toDispose).toHaveLength(0);
  });

  it('builds the new leading edge when crossing a chunk boundary but keeps the trailing edge (hysteresis)', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2, disposeRadius: 3 });
    streamer.update(256, 256); // chunk (16, 16); live columns 14..18

    const diff = streamer.update(272, 256); // one chunk east -> chunk (17, 16)

    // New leading column 19 built; trailing column 14 is at Chebyshev
    // distance 3 <= disposeRadius, so nothing is disposed yet.
    expect(diff.toBuild.sort()).toEqual(['19,14', '19,15', '19,16', '19,17', '19,18']);
    expect(diff.toDispose).toHaveLength(0);
    expect(streamer.liveCount).toBe(30);
  });

  it('does not thrash build/dispose when walking back and forth across one chunk border', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2, disposeRadius: 3 });
    streamer.update(256, 256); // chunk (16, 16)
    streamer.update(272, 256); // chunk (17, 16): builds column 19

    // Repeatedly stepping across the same border must settle to no-ops:
    // both live columns 14 and 19 stay within disposeRadius of both foci.
    for (let i = 0; i < 4; i++) {
      const back = streamer.update(271, 256); // chunk (16, 16) again
      expect(back.toBuild).toHaveLength(0);
      expect(back.toDispose).toHaveLength(0);

      const forth = streamer.update(272, 256); // chunk (17, 16) again
      expect(forth.toBuild).toHaveLength(0);
      expect(forth.toDispose).toHaveLength(0);
    }
  });

  it('disposes chunks left beyond the dispose radius after a long walk', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2, disposeRadius: 3 });
    streamer.update(256, 256); // chunk (16, 16); live columns 14..18

    const diff = streamer.update(320, 256); // chunk (20, 16)

    // Columns 14..16 are now at Chebyshev distance > 3 from chunk column 20.
    expect(diff.toDispose).toContain('14,16');
    expect(diff.toDispose).toContain('16,14');
    expect(diff.toDispose).not.toContain('17,16'); // distance 3: kept
    for (const key of diff.toDispose) {
      expect(streamer.liveKeys.has(key)).toBe(false);
    }
    for (const key of diff.toBuild) {
      expect(streamer.liveKeys.has(key)).toBe(true);
    }
  });

  it('keeps the live count bounded by the radius regardless of map size', () => {
    const giant = new ChunkStreamer({ ...GIANT, buildRadius: 2, disposeRadius: 3 });
    // Roseliam Map007-sized map: 20x23 tiles -> 2x2 chunk grid.
    const small = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 20,
      mapHeight: 23,
      buildRadius: 2,
      disposeRadius: 3,
    });

    const bound = (2 * 3 + 1) ** 2; // dispose-radius square

    // Walk the giant map corner to corner along a diagonal.
    for (let step = 0; step <= 511; step += 7) {
      giant.update(step, step);
      expect(giant.liveCount).toBeLessThanOrEqual(bound);
    }

    small.update(10, 11);
    // The small map is entirely inside the radius: all 4 chunks live, and
    // never more than the map has.
    expect(small.liveCount).toBe(4);
  });
});
