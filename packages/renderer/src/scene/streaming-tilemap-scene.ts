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

/** One scene-owned material clone backing a carved ceiling mesh, keyed by `${sheet}|${roomId}`. */
interface RoomMaterialEntry {
  readonly roomId: number;
  readonly material: THREE.Material;
}

/** Matches `buildChunkGroup`'s carve-mesh naming (`chunk-x-y-{sheet}-room-{id}`), extracting `sheet`/`roomId` from the end of the name regardless of how many dashes `chunkX`/`chunkY` contribute (negative coordinates). */
const ROOM_MESH_NAME_PATTERN = /-([A-Za-z0-9]+)-room-(\d+)$/;

function parseRoomMeshName(
  name: string,
): { readonly sheet: TileSheetId; readonly roomId: number } | null {
  const match = ROOM_MESH_NAME_PATTERN.exec(name);
  if (!match) return null;
  const sheet = match[1] as TileSheetId;
  const roomId = Number(match[2]);
  return { sheet, roomId };
}

/** Opaque rest opacity for a room's ceiling material -- identical to the shared per-sheet material's default state. */
const OPAQUE_ROOM_OPACITY = 1;
/** Locked decision (obs #110): faded ceilings settle at ~0.15, a near-transparent "there is a ceiling" ghost, never fully invisible. */
const FADED_ROOM_OPACITY = 0.15;
/** Fade tween rate, same cadence/shape as `apps/desktop/src/main.ts`'s `CAMERA_FOLLOW_SPEED` exponential camera-follow smoothing. */
const FADE_SPEED = 6;
/** Below this distance-to-target, `stepRoomFadeOpacity` snaps exactly onto the target instead of asymptotically approaching it forever -- required for the material state machine to ever reach its exact opaque-rest (`opacity === 1`) state. */
const FADE_SNAP_EPSILON = 0.001;

/**
 * One frame-step of the ceiling-fade exponential tween: framerate-independent
 * smoothing (same shape as the camera-follow lerp) that closes a fixed
 * fraction of the remaining distance to `target` per second, then snaps
 * exactly onto `target` once within `FADE_SNAP_EPSILON` -- exported as a pure
 * helper so the fade math is unit-testable without any three.js/material
 * plumbing.
 */
export function stepRoomFadeOpacity(
  current: number,
  target: number,
  dt: number,
  speed: number = FADE_SPEED,
): number {
  const amount = 1 - Math.exp(-speed * dt);
  const next = current + (target - current) * amount;
  return Math.abs(next - target) < FADE_SNAP_EPSILON ? target : next;
}

/**
 * Flips a room ceiling material between its two states (GOTCHA, see design
 * doc: three.js multiplies texture alpha by `opacity` BEFORE the `alphaTest`
 * discard, so the shared material's `alphaTest: 0.5` would fully discard
 * every fragment once opacity drops to ~0.15). `opaque` rest state
 * (`opacity === 1`) matches the shared per-sheet material exactly
 * (`transparent: false, alphaTest: 0.5, depthWrite: true`); any other
 * opacity -- mid-tween or settled at `FADED_ROOM_OPACITY` -- uses the faded
 * state (`transparent: true, alphaTest: 0, depthWrite: false`) so the ceiling
 * stays visible (as a translucent ghost) instead of being discarded.
 */
function applyRoomFadeState(material: THREE.Material, opacity: number): void {
  const isOpaqueRest = opacity >= OPAQUE_ROOM_OPACITY;
  material.opacity = opacity;
  material.transparent = !isOpaqueRest;
  material.depthWrite = isOpaqueRest;
  material.alphaTest = isOpaqueRest ? 0.5 : 0;
  material.needsUpdate = true;
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
  private wallTileKeys: ReadonlySet<string>;
  private disposed = false;

  /**
   * Scene-owned material CLONE pool for carved ceiling meshes, keyed
   * `${sheet}|${roomId}` -- created lazily the first time a carved mesh for
   * that (sheet, roomId) pair is built, then reused by every other chunk
   * carrying the same pair (a room commonly spans several chunks). Cloning
   * (instead of reusing `materialsBySheet[sheet]`, as Slice 3a's
   * `buildChunkGroup` output does by default) is what lets one room's fade
   * never mutate the shared per-sheet material or any other room's ceiling.
   * Lives for the scene's whole lifetime (same as `materialsBySheet` and
   * `shadowMaterial`) and is only disposed in `dispose()` -- NOT on
   * individual chunk unload, since the same clone is referenced by every
   * live chunk mesh sharing that (sheet, roomId) pair; disposing it early
   * would break whichever chunks are still using it.
   */
  private readonly roomMaterials = new Map<string, RoomMaterialEntry>();
  /** The room whose ceiling should be fading toward `FADED_ROOM_OPACITY`; `null` = no room faded (every cached room material tweens back toward opaque). */
  private fadedRoomId: number | null = null;

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
      if (!(child instanceof THREE.Mesh)) continue;
      geometries.push(child.geometry);

      // `buildChunkGroup` assigns every carved room mesh the SAME shared
      // per-sheet material instance as its sheet's normal mesh (Slice 3a is
      // geometry-only). Swap it here for this scene's own clone before the
      // mesh ever enters the live scene graph, so no carved mesh is ever
      // rendered even one frame with the shared instance.
      const roomInfo = parseRoomMeshName(child.name);
      if (roomInfo) child.material = this.getOrCreateRoomMaterial(roomInfo.sheet, roomInfo.roomId);
    }
    this.group.add(chunkGroup);
    this.liveChunks.set(key, { group: chunkGroup, geometries });
  }

  /**
   * Returns this scene's clone for `(sheet, roomId)`, creating it on first
   * use. A freshly created clone starts directly at whatever opacity state
   * currently applies to `roomId` (faded if it's the current `fadedRoomId`,
   * opaque otherwise) rather than tweening from opaque -- a chunk streamed
   * in while a room is already faded should never flash opaque for a frame.
   */
  private getOrCreateRoomMaterial(sheet: TileSheetId, roomId: number): THREE.Material {
    const key = `${sheet}|${roomId}`;
    const existing = this.roomMaterials.get(key);
    if (existing) return existing.material;

    const base = this.materialsBySheet[sheet];
    const material = base ? base.clone() : new THREE.MeshBasicMaterial();
    const targetOpacity = roomId === this.fadedRoomId ? FADED_ROOM_OPACITY : OPAQUE_ROOM_OPACITY;
    applyRoomFadeState(material, targetOpacity);
    this.roomMaterials.set(key, { roomId, material });
    return material;
  }

  /**
   * Sets which room's ceiling should be faded (toward `FADED_ROOM_OPACITY`,
   * ~0.15 per locked decision obs #110) -- `null` restores every room to
   * opaque. Only records the target; `updateFade(dt)` performs the actual
   * per-frame tween, matching the two-call shape Slice 4's game loop drives
   * (`setFadedRoom(roomId)` on tile arrival, `updateFade(dt)` every frame).
   */
  setFadedRoom(roomId: number | null): void {
    this.fadedRoomId = roomId;
  }

  /**
   * Advances every cached room material's opacity one frame-step toward its
   * current target (`FADED_ROOM_OPACITY` for `fadedRoomId`, opaque for every
   * other cached room), flipping the `alphaTest`/`transparent`/`depthWrite`
   * state machine (see `applyRoomFadeState`) as needed. A no-op once the
   * scene is disposed or when no room has ever been carved (empty cache).
   */
  updateFade(dt: number): void {
    if (this.disposed) return;
    for (const entry of this.roomMaterials.values()) {
      const target = entry.roomId === this.fadedRoomId ? FADED_ROOM_OPACITY : OPAQUE_ROOM_OPACITY;
      const current = entry.material.opacity;
      const next = stepRoomFadeOpacity(current, target, dt);
      if (next !== current) applyRoomFadeState(entry.material, next);
    }
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

  /**
   * Live-edit path for painting: replaces the stored `ChunkBuildData` for
   * every chunk in `chunks` (matching `buildChunks(..., onlyChunks)`'s
   * output for those keys), recomputes the whole-map `wallTileKeys`
   * occupancy from the updated data (a painted wall tile can change which
   * cross-chunk interior faces should cull, same as at initial load), and
   * rebuilds only the chunks that are both patched AND currently live --
   * chunks outside the streamed radius stay un-built, exactly like initial
   * load never builds them up front.
   *
   * ponytail: `wallTileKeys` is recomputed from the FULL updated chunk set,
   * so a patched chunk's OWN rebuilt geometry culls correctly against any
   * neighbor -- but a neighbor chunk NOT included in this call keeps its
   * stale (un-rebuilt) geometry even if the new wallTileKeys would now cull
   * one of its faces differently. Callers whose edit could affect a
   * neighbor's culling (e.g. painting a wall tile on a chunk's border) must
   * include that neighbor chunk's `ChunkBuildData` in the same `patchChunks`
   * call for its geometry to actually refresh -- this is exactly what the
   * editor paint pipeline's dirty-region expansion is for.
   *
   * To fully CLEAR a chunk that became empty (every tile on it erased),
   * the caller must still pass an entry for that key with an empty `tiles`
   * array (and no `shadows`) -- omitting the key entirely leaves its old
   * (now stale) data in place, since this method has no way to distinguish
   * "not touched" from "not passed".
   */
  patchChunks(chunks: readonly ChunkBuildData[]): void {
    if (this.disposed || chunks.length === 0) return;

    const patchedKeys: string[] = [];
    for (const chunk of chunks) {
      const key = chunkKey(chunk.chunkX, chunk.chunkY);
      this.chunkData.set(key, chunk);
      patchedKeys.push(key);
    }

    // Recomputed from the FULL, now-updated chunk data set -- not just the
    // patched chunks -- so a wall tile painted in one chunk still culls its
    // shared interior face against an already-live neighbor chunk, and vice
    // versa (matches the constructor's whole-map computation exactly).
    this.wallTileKeys = computeWallTileKeys(
      [...this.chunkData.values()].flatMap((chunk) => chunk.tiles),
    );

    for (const key of patchedKeys) {
      if (!this.liveChunks.has(key)) continue;
      this.disposeChunk(key);
      this.buildChunk(key);
    }
  }

  /** Frees everything: live chunk geometries, shared materials, and owned textures. */
  dispose(): void {
    if (this.disposed) return;
    for (const key of [...this.liveChunks.keys()]) this.disposeChunk(key);
    for (const material of Object.values(this.materialsBySheet)) material.dispose();
    for (const entry of this.roomMaterials.values()) entry.material.dispose();
    this.roomMaterials.clear();
    this.shadowMaterial.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.disposed = true;
  }
}
