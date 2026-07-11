import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EdgeDirection } from '../geometry/elevation.js';
import { computeOpenEdges, computeWallTileKeys, isWallSheet } from '../geometry/elevation.js';
import type { ChunkBuildData, ShadowBuildData, TileBuildData, UvRect } from '../geometry/types.js';

export interface BuildChunkGroupOptions {
  /** World-space size of one tile edge, both on the ground plane and for a wall quad's width. Default 1. */
  readonly tileWorldSize?: number;
  /** World-space height of an extruded "upper layer" (star-bit) standing quad. Default equals `tileWorldSize`. */
  readonly wallHeight?: number;
  /**
   * World-space height of one region-elevation step: a tile with region
   * height H has its floor at `y = H * heightUnit`. Default equals
   * `tileWorldSize` (one full tile-height per region step, the MV3D
   * convention).
   */
  readonly heightUnit?: number;
  /**
   * World-space height of an A3/A4 wall-autotile prism. Default
   * `2 * tileWorldSize` -- MV3D's zero-config wall height.
   */
  readonly wallPrismHeight?: number;
  /**
   * Shared material for the shadow-pencil overlay (typically black,
   * `transparent`, opacity 0.5, `depthWrite: false`). When omitted, shadow
   * data on the chunk is skipped -- same contract as a sheet with no
   * material.
   */
  readonly shadowMaterial?: THREE.Material;
  /**
   * Whole-map wall-tile occupancy (see `computeWallTileKeys`), used to cull
   * interior faces between adjacent A3/A4 wall prisms even when they sit in
   * different chunks. When omitted, falls back to this chunk's own tiles
   * only -- correct within a single chunk, but a wall tile at a chunk's edge
   * then always reports its border-facing sides as open, which can draw a
   * z-fighting interior face against a wall tile that actually continues in
   * the neighboring chunk. Callers building a whole map's worth of chunks
   * (`TilemapScene`, `StreamingTilemapScene`) always pass this.
   */
  readonly wallTileKeys?: ReadonlySet<string>;
}

/**
 * Fraction of a tile edge the shadow overlay floats above the ground plane,
 * so the coplanar translucent quads never z-fight the tiles beneath them.
 * Small enough to be invisible at the HD-2D camera tilt.
 */
const SHADOW_LIFT_FACTOR = 0.01;

/** Full-rect UV for untextured overlay quads (the material has no map, values are irrelevant). */
const FULL_UV: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

/**
 * One quarter-size dark quad per set shadow bit, replicating corescript's
 * `Tilemap._addShadow` bit order: bit 0 = upper-left, 1 = upper-right,
 * 2 = lower-left, 3 = lower-right ("upper" being map-north / smaller tileY).
 */
function buildShadowGeometry(
  shadow: ShadowBuildData,
  tileWorldSize: number,
  heightUnit: number,
): THREE.BufferGeometry[] {
  const half = tileWorldSize / 2;
  const worldX = shadow.tileX * tileWorldSize;
  const worldZ = shadow.tileY * tileWorldSize;
  const lift = tileWorldSize * SHADOW_LIFT_FACTOR + (shadow.height ?? 0) * heightUnit;

  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    if ((shadow.mask & (1 << i)) === 0) continue;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const quad = buildGroundQuad(FULL_UV, worldX + col * half, worldZ + row * half, half, half);
    quad.translate(0, lift, 0);
    geometries.push(quad);
  }
  return geometries;
}

/** Remaps a fresh `PlaneGeometry`'s default 0-1 UVs to a UV rect in-place. */
function applyQuadUv(geometry: THREE.PlaneGeometry, uv: UvRect): void {
  const uvAttribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
  uvAttribute.setXY(0, uv.u0, uv.v1);
  uvAttribute.setXY(1, uv.u1, uv.v1);
  uvAttribute.setXY(2, uv.u0, uv.v0);
  uvAttribute.setXY(3, uv.u1, uv.v0);
  uvAttribute.needsUpdate = true;
}

/** One ground-plane sub-quad of world-space size `width` x `depth`, corner-positioned at (worldX, worldZ), lying at y=0 (callers translate for elevation). */
function buildGroundQuad(
  uv: UvRect,
  worldX: number,
  worldZ: number,
  width: number,
  depth: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, depth);
  applyQuadUv(geometry, uv);
  geometry.rotateX(-Math.PI / 2); // lie flat, facing +Y
  geometry.translate(worldX + width / 2, 0, worldZ + depth / 2);
  return geometry;
}

/**
 * One standing wall sub-quad of world-space size `width` x `height`, corner
 * positioned at (worldX, baseY) and centered at `centerZ` in depth (a wall
 * quad never subdivides in Z -- it is a flat billboard at the tile's depth
 * center regardless of how many quarters compose it). Only used for the
 * single-sided star-bit "upper layer" quad (faces +Z only); wall *prisms*
 * (A3/A4) use `buildSideFaceQuad` below, which can face any of the 4 edges.
 */
function buildWallQuad(
  uv: UvRect,
  worldX: number,
  baseY: number,
  centerZ: number,
  width: number,
  height: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height);
  applyQuadUv(geometry, uv);
  // Faces +Z (toward a camera looking down at the map from the south).
  geometry.translate(worldX + width / 2, baseY + height / 2, centerZ);
  return geometry;
}

// A PlaneGeometry's default normal is +Z; rotating around Y by these angles
// aims it outward across each of a tile's 4 edges (see `buildSideFaceQuad`).
const EDGE_ROTATION_Y: Record<EdgeDirection, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

// Fraction of a tile's footprint (0-1 in both x/z) where each edge's face
// sits, matching `EDGE_ROTATION_Y`'s outward direction.
const EDGE_CENTER_OFFSET: Record<EdgeDirection, { readonly x: number; readonly z: number }> = {
  south: { x: 0.5, z: 1 },
  north: { x: 0.5, z: 0 },
  east: { x: 1, z: 0.5 },
  west: { x: 0, z: 0.5 },
};

/**
 * One side-face quad on tile `(worldX, worldZ)`-`(worldX+tileWorldSize,
 * worldZ+tileWorldSize)`'s given edge, spanning `[baseY, baseY+faceHeight]`.
 * Shared by wall prisms (A3/A4) and cliff faces -- both are "a vertical quad
 * on one edge of a tile's footprint", differing only in which edges get one
 * and over what height range.
 */
function buildSideFaceQuad(
  uv: UvRect,
  edge: EdgeDirection,
  worldX: number,
  worldZ: number,
  tileWorldSize: number,
  baseY: number,
  faceHeight: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(tileWorldSize, faceHeight);
  applyQuadUv(geometry, uv);
  geometry.rotateY(EDGE_ROTATION_Y[edge]);
  const offset = EDGE_CENTER_OFFSET[edge];
  geometry.translate(
    worldX + offset.x * tileWorldSize,
    baseY + faceHeight / 2,
    worldZ + offset.z * tileWorldSize,
  );
  return geometry;
}

/**
 * A tile's elevated-ground cliff faces (one per `tile.cliffEdges` entry,
 * spanning from the neighbor's height up to the tile's own). Textured with
 * the tile's own first quad, stretched across the face -- a deliberately
 * lazy default (see the design notes in the elevation slice this shipped
 * with); a dedicated cliff texture is a future knob, not this slice.
 */
function buildCliffGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  heightUnit: number,
): THREE.BufferGeometry[] {
  const cliffEdges = tile.cliffEdges;
  if (!cliffEdges || cliffEdges.length === 0) return [];
  const uv = tile.quads[0];
  if (!uv) return [];

  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const ownHeight = tile.height ?? 0;

  const geometries: THREE.BufferGeometry[] = [];
  for (const { edge, neighborHeight } of cliffEdges) {
    const faceHeight = (ownHeight - neighborHeight) * heightUnit;
    if (faceHeight <= 0) continue;
    const baseY = neighborHeight * heightUnit;
    geometries.push(buildSideFaceQuad(uv, edge, worldX, worldZ, tileWorldSize, baseY, faceHeight));
  }
  return geometries;
}

/**
 * A wall-autotile (A3/A4) tile's 3D prism: one side face per entry in
 * `openEdges` (the edges without a same-chunk wall-tile neighbor -- see
 * `computeOpenEdges`), textured with the tile's own first quad stretched
 * across the prism's height (same lazy-default choice as cliff faces), plus
 * a flat top cap reusing the tile's full quad composition (quarters for an
 * autotile) so an A4 floor-style top texture reads correctly.
 */
function buildWallPrismGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  wallPrismHeight: number,
  heightUnit: number,
  openEdges: readonly EdgeDirection[],
): THREE.BufferGeometry[] {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const baseY = (tile.height ?? 0) * heightUnit;
  const capY = baseY + wallPrismHeight;

  const geometries: THREE.BufferGeometry[] = [];

  const sideUv = tile.quads[0];
  if (sideUv) {
    for (const edge of openEdges) {
      geometries.push(
        buildSideFaceQuad(sideUv, edge, worldX, worldZ, tileWorldSize, baseY, wallPrismHeight),
      );
    }
  }

  if (tile.quads.length === 4) {
    const half = tileWorldSize / 2;
    for (let i = 0; i < 4; i++) {
      const uv = tile.quads[i];
      if (!uv) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cap = buildGroundQuad(uv, worldX + col * half, worldZ + row * half, half, half);
      cap.translate(0, capY, 0);
      geometries.push(cap);
    }
  } else {
    const uv = tile.quads[0];
    if (uv) {
      const cap = buildGroundQuad(uv, worldX, worldZ, tileWorldSize, tileWorldSize);
      cap.translate(0, capY, 0);
      geometries.push(cap);
    }
  }

  return geometries;
}

/**
 * Builds one tile's quad geometry/geometries, positioned in world space.
 *
 * - Star-bit "upper layer" tiles (`tile.elevation === 'upper'`) keep the
 *   original standing-quad behavior regardless of sheet: a single-sided
 *   vertical quad (or 4 quarter-quads for an autotile), lifted by the
 *   tile's own region elevation.
 * - A3/A4 wall-autotile tiles become 3D prisms (`buildWallPrismGeometry`).
 * - Everything else is a flat ground quad at `y = tile.height * heightUnit`,
 *   plus any cliff side faces the tile's elevation needs.
 *
 * A plain tile (`tile.quads.length === 1`) yields one full-size quad. An
 * autotile (`tile.quads.length === 4`) yields 4 quarter-size quads, one per
 * quadrant of the tile's footprint, in the same destination order `tile-uv.ts`
 * documents: [top-left, top-right, bottom-left, bottom-right], where "top" is
 * the map-north/image-top edge (smaller tileY) and "left" is the map-west
 * edge (smaller tileX). For an upper-layer wall, "top" instead maps to the
 * upper half of the standing quad (nearer wallHeight), matching how the
 * single-quad case already maps image-top to the plane's local +Y (see
 * `applyQuadUv`: vertex 0/1's v1 uses the source rect's top edge, and those
 * are the PlaneGeometry vertices at local +height/2, which point toward
 * wallHeight after the translate below).
 */
function buildTileGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  wallHeight: number,
  heightUnit: number,
  wallPrismHeight: number,
  wallOpenEdges: readonly EdgeDirection[],
): THREE.BufferGeometry[] {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const elevationLift = (tile.height ?? 0) * heightUnit;

  if (tile.elevation === 'upper') {
    if (tile.quads.length === 4) {
      const half = tileWorldSize / 2;
      const halfWallHeight = wallHeight / 2;
      const centerZ = worldZ + tileWorldSize / 2;
      const geometries: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        const uv = tile.quads[i];
        if (!uv) continue;
        const col = i % 2; // 0 = west/left, 1 = east/right
        const row = Math.floor(i / 2); // 0 = north/image-top, 1 = south/image-bottom
        const baseY = (row === 0 ? halfWallHeight : 0) + elevationLift;
        geometries.push(
          buildWallQuad(uv, worldX + col * half, baseY, centerZ, half, halfWallHeight),
        );
      }
      return geometries;
    }

    const uv = tile.quads[0];
    if (!uv) return [];
    return [
      buildWallQuad(
        uv,
        worldX,
        elevationLift,
        worldZ + tileWorldSize / 2,
        tileWorldSize,
        wallHeight,
      ),
    ];
  }

  if (isWallSheet(tile.sheet)) {
    return buildWallPrismGeometry(tile, tileWorldSize, wallPrismHeight, heightUnit, wallOpenEdges);
  }

  const geometries: THREE.BufferGeometry[] = [];
  if (tile.quads.length === 4) {
    const half = tileWorldSize / 2;
    for (let i = 0; i < 4; i++) {
      const uv = tile.quads[i];
      if (!uv) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const quad = buildGroundQuad(uv, worldX + col * half, worldZ + row * half, half, half);
      if (elevationLift !== 0) quad.translate(0, elevationLift, 0);
      geometries.push(quad);
    }
  } else {
    const uv = tile.quads[0];
    if (uv) {
      const quad = buildGroundQuad(uv, worldX, worldZ, tileWorldSize, tileWorldSize);
      if (elevationLift !== 0) quad.translate(0, elevationLift, 0);
      geometries.push(quad);
    }
  }
  geometries.push(...buildCliffGeometry(tile, tileWorldSize, heightUnit));
  return geometries;
}

/**
 * Builds one `THREE.Group` for a chunk, containing one `Mesh` per sheet used
 * by that chunk's tiles. Each mesh's geometry is a single merged
 * `BufferGeometry` (ground and upper-layer quads combined) so a chunk costs
 * at most one draw call per sheet, not one per tile.
 *
 * A sheet with no entry in `materials` (not loaded, or genuinely unused) is
 * skipped rather than throwing -- callers only need to provide materials for
 * the sheets they actually loaded.
 */
export function buildChunkGroup(
  chunk: ChunkBuildData,
  materials: Partial<Record<TileSheetId, THREE.Material>>,
  options: BuildChunkGroupOptions = {},
): THREE.Group {
  const tileWorldSize = options.tileWorldSize ?? 1;
  const wallHeight = options.wallHeight ?? tileWorldSize;
  const heightUnit = options.heightUnit ?? tileWorldSize;
  const wallPrismHeight = options.wallPrismHeight ?? 2 * tileWorldSize;

  // Wall-tile adjacency for interior-face culling: whole-map when the caller
  // provides it (see `BuildChunkGroupOptions.wallTileKeys`), else falls back
  // to this chunk's own tiles only.
  const wallTileKeys = options.wallTileKeys ?? computeWallTileKeys(chunk.tiles);

  const geometriesBySheet = new Map<TileSheetId, THREE.BufferGeometry[]>();
  for (const tile of chunk.tiles) {
    const isWallTile = tile.elevation !== 'upper' && isWallSheet(tile.sheet);
    const openEdges = isWallTile ? computeOpenEdges(wallTileKeys, tile.tileX, tile.tileY) : [];

    const geometries = geometriesBySheet.get(tile.sheet) ?? [];
    geometries.push(
      ...buildTileGeometry(tile, tileWorldSize, wallHeight, heightUnit, wallPrismHeight, openEdges),
    );
    geometriesBySheet.set(tile.sheet, geometries);
  }

  const group = new THREE.Group();
  group.name = `chunk-${chunk.chunkX}-${chunk.chunkY}`;

  for (const [sheet, geometries] of geometriesBySheet) {
    const material = materials[sheet];
    if (!material) {
      for (const geometry of geometries) geometry.dispose();
      continue;
    }

    const merged = mergeGeometries(geometries, false) as THREE.BufferGeometry | null;
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `chunk-${chunk.chunkX}-${chunk.chunkY}-${sheet}`;
    group.add(mesh);
  }

  const shadows = chunk.shadows ?? [];
  if (options.shadowMaterial && shadows.length > 0) {
    const shadowGeometries = shadows.flatMap((shadow) =>
      buildShadowGeometry(shadow, tileWorldSize, heightUnit),
    );
    const merged = mergeGeometries(shadowGeometries, false) as THREE.BufferGeometry | null;
    for (const geometry of shadowGeometries) geometry.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, options.shadowMaterial);
      mesh.name = `chunk-${chunk.chunkX}-${chunk.chunkY}-shadow`;
      group.add(mesh);
    }
  }

  return group;
}
