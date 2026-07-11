import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { computeWallTileKeys } from '../geometry/elevation.js';
import type { ChunkBuildData } from '../geometry/types.js';
import { chunkKey } from '../streaming/chunk-streamer.js';
import { type BuildChunkGroupOptions, buildChunkGroup } from './build-chunk-group.js';
import type { PixelArtTextureOptions } from './pixel-art-texture.js';
import { createShadowMaterial, createSheetMaterials } from './sheet-materials.js';

export interface StreamingTilemapSceneOptions
  extends Omit<BuildChunkGroupOptions, 'shadowMaterial' | 'wallTileKeys'> {
  /**
   * Whether `dispose()` also disposes the provided sheet textures. Pass
   * `false` when the same textures back several scenes over time (e.g.
   * switching maps that share a tileset) and the caller frees them itself.
   * Default `true`, matching `TilemapScene`.
   */
  readonly ownsTextures?: boolean;
  /** Forwarded to `createSheetMaterials` for every sheet texture; see `PixelArtTextureOptions`. */
  readonly textureOptions?: PixelArtTextureOptions;
}

/** The subset of a `ChunkStreamer` diff this scene consumes (kept structural to avoid a hard coupling). */
export interface ChunkSetDiff {
  readonly toBuild: readonly string[];
  readonly toDispose: readonly string[];
}

interface LiveChunk {
  readonly group: THREE.Group;
  readonly geometries: readonly THREE.BufferGeometry[];
}

/**
 * Streaming variant of `TilemapScene`: holds the whole map's pure
 * `ChunkBuildData` (cheap -- plain numbers, no GPU resources) but only
 * builds three.js geometry for chunks explicitly requested via
 * `buildChunk`/`applyDiff`, and frees per-chunk geometry again on
 * `disposeChunk`. Materials and textures stay shared across all chunks and
 * live until `dispose()`.
 *
 * Pair it with a `ChunkStreamer` tracking the player/camera focus:
 * `scene.applyDiff(streamer.update(tileX, tileY))` each frame keeps GPU
 * memory bounded by the streaming radius no matter how large the map is.
 */
export class StreamingTilemapScene {
  readonly group: THREE.Group;

  private readonly chunkData = new Map<string, ChunkBuildData>();
  private readonly liveChunks = new Map<string, LiveChunk>();
  private readonly materialsBySheet: Partial<Record<TileSheetId, THREE.Material>>;
  private readonly shadowMaterial: THREE.Material;
  private readonly ownedTextures: THREE.Texture[];
  private readonly buildOptions: Omit<BuildChunkGroupOptions, 'shadowMaterial'>;
  private readonly wallTileKeys: ReadonlySet<string>;
  private disposed = false;

  constructor(
    chunks: readonly ChunkBuildData[],
    textures: Partial<Record<TileSheetId, THREE.Texture>>,
    options: StreamingTilemapSceneOptions = {},
  ) {
    this.group = new THREE.Group();
    this.group.name = 'tilemap';

    const { ownsTextures = true, textureOptions, ...buildOptions } = options;
    this.buildOptions = buildOptions;
    this.materialsBySheet = createSheetMaterials(textures, textureOptions);
    this.shadowMaterial = createShadowMaterial();
    this.ownedTextures = ownsTextures ? Object.values(textures) : [];

    for (const chunk of chunks) {
      this.chunkData.set(chunkKey(chunk.chunkX, chunk.chunkY), chunk);
    }

    // Whole-map wall-tile occupancy, computed once up front (from every
    // chunk's data, not just the chunks currently live) so cross-chunk wall
    // prisms cull their shared interior faces correctly regardless of
    // streaming order -- see `computeWallTileKeys` /
    // `BuildChunkGroupOptions.wallTileKeys`.
    this.wallTileKeys = computeWallTileKeys(chunks.flatMap((chunk) => chunk.tiles));
  }

  /** Number of chunks with live GPU geometry right now. */
  get liveChunkCount(): number {
    return this.liveChunks.size;
  }

  /** Builds one chunk's meshes if the map has data for it; no-op for live or unknown keys. */
  buildChunk(key: string): void {
    if (this.disposed || this.liveChunks.has(key)) return;
    const chunk = this.chunkData.get(key);
    if (!chunk) return;

    const chunkGroup = buildChunkGroup(chunk, this.materialsBySheet, {
      ...this.buildOptions,
      shadowMaterial: this.shadowMaterial,
      wallTileKeys: this.wallTileKeys,
    });
    const geometries: THREE.BufferGeometry[] = [];
    for (const child of chunkGroup.children) {
      if (child instanceof THREE.Mesh) geometries.push(child.geometry);
    }
    this.group.add(chunkGroup);
    this.liveChunks.set(key, { group: chunkGroup, geometries });
  }

  /** Frees one chunk's geometry and removes it from the scene; shared materials/textures stay alive. */
  disposeChunk(key: string): void {
    const live = this.liveChunks.get(key);
    if (!live) return;
    this.group.remove(live.group);
    for (const geometry of live.geometries) geometry.dispose();
    this.liveChunks.delete(key);
  }

  /** Applies a `ChunkStreamer` diff: builds entering chunks, disposes leaving ones. */
  applyDiff(diff: ChunkSetDiff): void {
    for (const key of diff.toDispose) this.disposeChunk(key);
    for (const key of diff.toBuild) this.buildChunk(key);
  }

  /** Frees everything: live chunk geometries, shared materials, and owned textures. */
  dispose(): void {
    if (this.disposed) return;
    for (const key of [...this.liveChunks.keys()]) this.disposeChunk(key);
    for (const material of Object.values(this.materialsBySheet)) material.dispose();
    this.shadowMaterial.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.disposed = true;
  }
}
