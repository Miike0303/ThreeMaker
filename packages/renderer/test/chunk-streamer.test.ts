import { describe, expect, it, vi } from 'vitest';
import { ChunkStreamer, chunkKey } from '../src/streaming/chunk-streamer.js';

/** 512x512-tile map, 16-tile chunks -> a 32x32 chunk grid. */
const GIANT = { chunkSize: 16, mapWidth: 512, mapHeight: 512 } as const;

describe('chunkKey', () => {
  it('matches the "{chunkX},{chunkY}" format buildChunks sorts by', () => {
    expect(chunkKey(3, 7)).toBe('3,7');
  });
});

describe('ChunkStreamer', () => {
  it('reports invalid chunk sizes with the general Error name', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: Number.NaN })).toThrow(
      expect.objectContaining({ name: 'Error' }),
    );
  });

  it('reports invalid build radii with the general Error name', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 0.5 })).toThrow(
      expect.objectContaining({ name: 'Error' }),
    );
  });

  it('reports invalid disposal radii with the general Error name', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 1, disposeRadius: 0 })).toThrow(
      expect.objectContaining({ name: 'Error' }),
    );
  });

  it('disposes a departed window in the order its chunks were built', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 64,
      mapHeight: 64,
      buildRadius: 1,
      disposeRadius: 1,
    });
    streamer.update(0, 0);

    expect(streamer.update(48, 48).toDispose).toEqual(['0,0', '1,0', '0,1', '1,1']);
  });

  it('clamps a high X focus to the last tile with half-tile chunks', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 0.5,
      mapWidth: 2,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });
    expect(streamer.update(1, 0).toBuild).toEqual(['2,0']);

    expect(streamer.update(99, 0)).toEqual({ toBuild: [], toDispose: [] });
    expect([...streamer.liveKeys]).toEqual(['2,0']);
  });

  it('clamps a high Y focus to the last tile with half-tile chunks', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 0.5,
      mapWidth: 1,
      mapHeight: 2,
      buildRadius: 0,
      disposeRadius: 0,
    });
    expect(streamer.update(0, 1).toBuild).toEqual(['0,2']);

    expect(streamer.update(0, 99)).toEqual({ toBuild: [], toDispose: [] });
    expect([...streamer.liveKeys]).toEqual(['0,2']);
  });

  it('clips a build radius beyond the safe-integer range to the map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 48,
      mapHeight: 32,
      buildRadius: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(streamer.update(16, 16)).toEqual({
      toBuild: ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'],
      toDispose: [],
    });
    expect(streamer.liveCount).toBe(6);
  });

  it('keeps visited chunks live with a disposal radius beyond the safe-integer range', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 64,
      mapHeight: 16,
      buildRadius: 0,
      disposeRadius: Number.MAX_SAFE_INTEGER + 1,
    });
    streamer.update(0, 0);

    expect(streamer.update(48, 0)).toEqual({ toBuild: ['3,0'], toDispose: [] });
    expect([...streamer.liveKeys]).toEqual(['0,0', '3,0']);
  });

  it('keeps trailing chunks at the default disposal boundary for an odd build radius', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 96,
      mapHeight: 16,
      buildRadius: 1,
    });
    streamer.update(32, 0);

    expect(streamer.update(48, 0)).toEqual({ toBuild: ['4,0'], toDispose: [] });
    expect(streamer.liveKeys.has('1,0')).toBe(true);
  });

  it('clamps an out-of-bounds X focus to the final chunk of an even-width map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 4,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });
    expect(streamer.update(3, 0).toBuild).toEqual(['3,0']);

    expect(streamer.update(99, 0)).toEqual({ toBuild: [], toDispose: [] });
    expect([...streamer.liveKeys]).toEqual(['3,0']);
  });

  it('defaults the disposal radius without modifying frozen options', () => {
    const options = Object.freeze({ ...GIANT, buildRadius: 0 });
    const streamer = new ChunkStreamer(options);
    streamer.update(256, 256);

    expect(streamer.update(272, 256)).toEqual({ toBuild: ['17,16'], toDispose: [] });
  });

  it('defaults the build radius without modifying frozen options', () => {
    const options = Object.freeze({ ...GIANT, disposeRadius: 3 });

    const streamer = new ChunkStreamer(options);

    expect(streamer.update(256, 256).toBuild).toContain('16,16');
  });

  it('floors the focus column before selecting a fractional-size chunk', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1.5,
      mapWidth: 3,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });
    expect(streamer.update(1, 0).toBuild).toEqual(['0,0']);

    expect(streamer.update(1.5, 0)).toEqual({ toBuild: [], toDispose: [] });
    expect(streamer.update(2, 0)).toEqual({ toBuild: ['1,0'], toDispose: ['0,0'] });
  });

  it('floors the focus row before selecting a fractional-size chunk', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1.5,
      mapWidth: 1,
      mapHeight: 3,
      buildRadius: 0,
      disposeRadius: 0,
    });
    expect(streamer.update(0, 1).toBuild).toEqual(['0,0']);

    expect(streamer.update(0, 1.5)).toEqual({ toBuild: [], toDispose: [] });
    expect(streamer.update(0, 2)).toEqual({ toBuild: ['0,1'], toDispose: ['0,0'] });
  });

  it('accepts a positive chunk size smaller than one tile', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 0.5,
      mapWidth: 2,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(1, 0)).toEqual({ toBuild: ['2,0'], toDispose: [] });
  });

  it('rejects a numeric string chunk size instead of coercing it', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: '16' as unknown as number })).toThrow(
      'chunkSize must be a positive number, got 16.',
    );
  });

  it('rebuilds and disposes chunks after traveling west beyond the live window', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 64,
      mapHeight: 16,
      buildRadius: 0,
      disposeRadius: 0,
    });
    streamer.update(48, 0);

    expect(streamer.update(0, 0)).toEqual({ toBuild: ['0,0'], toDispose: ['3,0'] });
    expect([...streamer.liveKeys]).toEqual(['0,0']);
  });

  it('rebuilds and disposes chunks after traveling north beyond the live window', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 16,
      mapHeight: 64,
      buildRadius: 0,
      disposeRadius: 0,
    });
    streamer.update(0, 48);

    expect(streamer.update(0, 0)).toEqual({ toBuild: ['0,0'], toDispose: ['0,3'] });
    expect([...streamer.liveKeys]).toEqual(['0,0']);
  });

  it('reports the rejected build radius in validation errors', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 0.5 })).toThrow(
      'buildRadius must be a non-negative integer, got 0.5.',
    );
  });

  it('reports the rejected dispose radius alongside the minimum build radius', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 3, disposeRadius: 2 })).toThrow(
      'disposeRadius must be an integer >= buildRadius (3), got 2.',
    );
  });

  it('honors an explicit zero disposal radius when crossing a chunk boundary', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 48,
      mapHeight: 16,
      buildRadius: 0,
      disposeRadius: 0,
    });
    streamer.update(0, 0);

    expect(streamer.update(16, 0)).toEqual({ toBuild: ['1,0'], toDispose: ['0,0'] });
    expect([...streamer.liveKeys]).toEqual(['1,0']);
  });

  it('tracks the previous focus row independently of its column', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 48,
      mapHeight: 48,
      buildRadius: 0,
      disposeRadius: 0,
    });
    streamer.update(16, 0);

    expect(streamer.update(16, 16).toBuild).toEqual(['1,1']);
  });

  it('tracks the previous focus column independently of its row', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 48,
      mapHeight: 48,
      buildRadius: 0,
      disposeRadius: 0,
    });
    streamer.update(0, 16);

    expect(streamer.update(16, 16).toBuild).toEqual(['1,1']);
  });

  it('rejects a finite negative chunk size', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: -16 })).toThrow(
      'chunkSize must be a positive number, got -16.',
    );
  });

  it('recomputes the build window when only the focus row changes', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 32,
      mapHeight: 48,
      buildRadius: 0,
      disposeRadius: 1,
    });
    streamer.update(0, 0);

    expect(streamer.update(0, 16).toBuild).toEqual(['0,1']);
  });

  it('disposes chunks behind a southbound focus outside the Y radius', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 48,
      mapHeight: 80,
      buildRadius: 0,
      disposeRadius: 1,
    });
    streamer.update(16, 0);

    expect(streamer.update(16, 48).toDispose).toEqual(['1,0']);
    expect(streamer.liveKeys.has('1,0')).toBe(false);
  });

  it('clamps a negative X focus to column zero with one-tile chunks', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 3,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(-1, 0).toBuild).toEqual(['0,0']);
  });

  it('clamps a negative Y focus to row zero with one-tile chunks', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 1,
      mapHeight: 3,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, -1).toBuild).toEqual(['0,0']);
  });

  it('keeps one fallback chunk for an empty map width', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 0,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, 0).toBuild).toEqual(['0,0']);
  });

  it('keeps one fallback chunk for an empty map height', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 1,
      mapHeight: 0,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, 0).toBuild).toEqual(['0,0']);
  });

  it('rejects an infinite chunk size even with finite map dimensions', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: Number.POSITIVE_INFINITY })).toThrow(
      /chunkSize/,
    );
  });

  it('clamps a high Y focus to the only row of a one-tile map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 1,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, 99).toBuild).toEqual(['0,0']);
  });

  it('pins the default build radius at two chunks', () => {
    const streamer = new ChunkStreamer({ chunkSize: 16, mapWidth: 80, mapHeight: 80 });

    expect(streamer.update(32, 32).toBuild).toHaveLength(25);
  });

  it('pins rejection of a fractional build radius', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 0.5, disposeRadius: 1 })).toThrow(
      /buildRadius/,
    );
  });

  it('pins an out-of-bounds Y focus to the final one-tile chunk', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 16,
      mapHeight: 33,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, 99).toBuild).toEqual(['0,2']);
  });

  it('keeps an out-of-bounds X focus in a one-tile-wide map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1,
      mapWidth: 1,
      mapHeight: 1,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(99, 0).toBuild).toEqual(['0,0']);
  });

  it('does not build a phantom X chunk in a one-chunk-wide map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 16,
      mapHeight: 32,
      buildRadius: 1,
      disposeRadius: 1,
    });

    expect(streamer.update(0, 16).toBuild).toEqual(['0,0', '0,1']);
  });

  it('does not build a phantom Y chunk in a one-chunk-tall map', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 32,
      mapHeight: 16,
      buildRadius: 1,
      disposeRadius: 1,
    });

    expect(streamer.update(16, 0).toBuild).toEqual(['0,0', '1,0']);
  });

  it('builds the final column of a map wider than it is tall', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 64,
      mapHeight: 16,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(63, 0).toBuild).toEqual(['3,0']);
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => new ChunkStreamer({ ...GIANT, chunkSize: 0 })).toThrow(/chunkSize/);
  });

  it('accepts a positive fractional chunk size', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 1.5,
      mapWidth: 3,
      mapHeight: 2,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(2, 0).toBuild).toEqual(['1,0']);
  });

  it('rejects a negative build radius', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: -1 })).toThrow(/buildRadius/);
  });

  it('rejects a dispose radius smaller than the build radius (hysteresis inverted)', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 3, disposeRadius: 2 })).toThrow(
      /disposeRadius/,
    );
  });

  it('rejects a fractional dispose radius', () => {
    expect(() => new ChunkStreamer({ ...GIANT, buildRadius: 1, disposeRadius: 1.5 })).toThrow(
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

  it('keeps a fractional focus inside its current chunk until the boundary is crossed', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 32,
      mapHeight: 16,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(15.5, 0).toBuild).toEqual(['0,0']);
  });

  it('keeps a fractional Y focus inside its current chunk until the boundary is crossed', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 16,
      mapHeight: 32,
      buildRadius: 0,
      disposeRadius: 0,
    });

    expect(streamer.update(0, 15.5).toBuild).toEqual(['0,0']);
  });

  it('returns an empty diff while the focus stays inside the same chunk', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });
    streamer.update(256, 256);

    const diff = streamer.update(257, 258); // still chunk (16, 16)

    expect(diff.toBuild).toHaveLength(0);
    expect(diff.toDispose).toHaveLength(0);
  });

  it('avoids rescanning live chunks while the focus stays inside the same chunk', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });
    streamer.update(256, 256);
    const scan = vi.spyOn(streamer.liveKeys, Symbol.iterator);

    try {
      expect(streamer.update(257, 258)).toEqual({ toBuild: [], toDispose: [] });
      expect(scan).not.toHaveBeenCalled();

      streamer.update(272, 258);
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      scan.mockRestore();
    }
  });

  it('defaults dispose radius to one chunk beyond the build radius', () => {
    const streamer = new ChunkStreamer({ ...GIANT, buildRadius: 2 });
    streamer.update(256, 256);

    const diff = streamer.update(272, 256); // one chunk east

    expect(diff.toDispose).toHaveLength(0);
  });

  it('disposes a chunk two steps behind when the default build radius is zero', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 64,
      mapHeight: 16,
      buildRadius: 0,
    });
    streamer.update(0, 0);

    expect(streamer.update(32, 0).toDispose).toEqual(['0,0']);
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

  it('returns a single disposal when revisiting an already-built map-edge window', () => {
    const streamer = new ChunkStreamer({
      chunkSize: 16,
      mapWidth: 80,
      mapHeight: 16,
      buildRadius: 1,
      disposeRadius: 3,
    });
    streamer.update(0, 0);
    streamer.update(48, 0);

    expect(streamer.update(0, 0)).toEqual({ toBuild: [], toDispose: ['4,0'] });
    expect(streamer.liveKeys.has('4,0')).toBe(false);
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
