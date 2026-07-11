/** Default streaming radius, in chunks, within which chunk geometry must be live. */
export const DEFAULT_BUILD_RADIUS = 2;

export interface ChunkStreamerOptions {
  /** Chunk edge length in tiles; must match the `chunkSize` passed to `buildChunks`. */
  readonly chunkSize: number;
  /** Full map width in tiles. */
  readonly mapWidth: number;
  /** Full map height in tiles. */
  readonly mapHeight: number;
  /** Chunks within this Chebyshev distance of the focus chunk must be live. Default 2. */
  readonly buildRadius?: number;
  /**
   * Live chunks farther than this Chebyshev distance are disposed. Must be
   * >= `buildRadius`; keeping it strictly larger adds hysteresis so a focus
   * oscillating across one chunk border never build/dispose-thrashes.
   * Default `buildRadius + 1`.
   */
  readonly disposeRadius?: number;
}

/** The chunk set delta one `ChunkStreamer.update` call asks the scene layer to apply. */
export interface ChunkStreamDiff {
  /** Chunk keys that entered the build radius and need live geometry. */
  readonly toBuild: readonly string[];
  /** Chunk keys that left the dispose radius and should free their geometry. */
  readonly toDispose: readonly string[];
}

const EMPTY_DIFF: ChunkStreamDiff = { toBuild: [], toDispose: [] };

/** Canonical chunk key, matching the `"{chunkX},{chunkY}"` grouping key used by `buildChunks`. */
export function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Pure chunk-streaming policy: given a focus tile (the character or camera
 * target), decides which chunks must have live GPU geometry and which can be
 * disposed. Holds no three.js state -- it only tracks the set of live chunk
 * keys, so the scene layer can apply the returned diff however it likes.
 *
 * The live set is bounded by the dispose radius square regardless of map
 * size, which is the whole point: a 512x512 map costs the same GPU memory as
 * a 20x23 one.
 */
export class ChunkStreamer {
  private readonly chunkSize: number;
  private readonly chunksX: number;
  private readonly chunksY: number;
  private readonly maxTileX: number;
  private readonly maxTileY: number;
  private readonly buildRadius: number;
  private readonly disposeRadius: number;
  private readonly live = new Set<string>();
  private lastFocusChunkX = -1;
  private lastFocusChunkY = -1;
  private initialized = false;

  constructor(options: ChunkStreamerOptions) {
    const { chunkSize, mapWidth, mapHeight } = options;
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      throw new Error(`chunkSize must be a positive number, got ${chunkSize}.`);
    }
    const buildRadius = options.buildRadius ?? DEFAULT_BUILD_RADIUS;
    if (!Number.isInteger(buildRadius) || buildRadius < 0) {
      throw new Error(`buildRadius must be a non-negative integer, got ${buildRadius}.`);
    }
    const disposeRadius = options.disposeRadius ?? buildRadius + 1;
    if (!Number.isInteger(disposeRadius) || disposeRadius < buildRadius) {
      throw new Error(
        `disposeRadius must be an integer >= buildRadius (${buildRadius}), got ${disposeRadius}.`,
      );
    }

    this.chunkSize = chunkSize;
    this.chunksX = Math.max(1, Math.ceil(mapWidth / chunkSize));
    this.chunksY = Math.max(1, Math.ceil(mapHeight / chunkSize));
    this.maxTileX = Math.max(0, mapWidth - 1);
    this.maxTileY = Math.max(0, mapHeight - 1);
    this.buildRadius = buildRadius;
    this.disposeRadius = disposeRadius;
  }

  /** Chunk keys currently considered live (built and not yet disposed). */
  get liveKeys(): ReadonlySet<string> {
    return this.live;
  }

  /** Number of currently-live chunks. */
  get liveCount(): number {
    return this.live.size;
  }

  /**
   * Recomputes the live set for a focus tile position and returns the delta.
   * Cheap to call every frame: while the focus stays inside the same chunk
   * it early-exits with an empty diff.
   */
  update(focusTileX: number, focusTileY: number): ChunkStreamDiff {
    const tileX = clamp(Math.floor(focusTileX), 0, this.maxTileX);
    const tileY = clamp(Math.floor(focusTileY), 0, this.maxTileY);
    const focusChunkX = Math.floor(tileX / this.chunkSize);
    const focusChunkY = Math.floor(tileY / this.chunkSize);

    if (
      this.initialized &&
      focusChunkX === this.lastFocusChunkX &&
      focusChunkY === this.lastFocusChunkY
    ) {
      return EMPTY_DIFF;
    }
    this.initialized = true;
    this.lastFocusChunkX = focusChunkX;
    this.lastFocusChunkY = focusChunkY;

    const toBuild: string[] = [];
    const minX = Math.max(0, focusChunkX - this.buildRadius);
    const maxX = Math.min(this.chunksX - 1, focusChunkX + this.buildRadius);
    const minY = Math.max(0, focusChunkY - this.buildRadius);
    const maxY = Math.min(this.chunksY - 1, focusChunkY + this.buildRadius);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const key = chunkKey(cx, cy);
        if (!this.live.has(key)) {
          toBuild.push(key);
          this.live.add(key);
        }
      }
    }

    const toDispose: string[] = [];
    for (const key of this.live) {
      const [xPart, yPart] = key.split(',');
      const distance = Math.max(
        Math.abs(Number(xPart) - focusChunkX),
        Math.abs(Number(yPart) - focusChunkY),
      );
      if (distance > this.disposeRadius) toDispose.push(key);
    }
    for (const key of toDispose) this.live.delete(key);

    if (toBuild.length === 0 && toDispose.length === 0) return EMPTY_DIFF;
    return { toBuild, toDispose };
  }
}
