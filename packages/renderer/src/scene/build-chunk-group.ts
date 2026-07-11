import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkBuildData, ShadowBuildData, TileBuildData, UvRect } from '../geometry/types.js';

export interface BuildChunkGroupOptions {
  /** World-space size of one tile edge, both on the ground plane and for a wall quad's width. Default 1. */
  readonly tileWorldSize?: number;
  /** World-space height of an extruded "upper layer" wall quad. Default equals `tileWorldSize`. */
  readonly wallHeight?: number;
  /**
   * Shared material for the shadow-pencil overlay (typically black,
   * `transparent`, opacity 0.5, `depthWrite: false`). When omitted, shadow
   * data on the chunk is skipped -- same contract as a sheet with no
   * material.
   */
  readonly shadowMaterial?: THREE.Material;
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
): THREE.BufferGeometry[] {
  const half = tileWorldSize / 2;
  const worldX = shadow.tileX * tileWorldSize;
  const worldZ = shadow.tileY * tileWorldSize;
  const lift = tileWorldSize * SHADOW_LIFT_FACTOR;

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

/** One ground-plane sub-quad of world-space size `width` x `depth`, corner-positioned at (worldX, worldZ). */
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
 * center regardless of how many quarters compose it).
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

/**
 * Builds one tile's quad geometry/geometries, positioned in world space.
 * Ground tiles lie flat on the XZ plane at y=0; "upper layer" tiles stand up
 * as a vertical wall-like quad from y=0 to y=wallHeight.
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
): THREE.BufferGeometry[] {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;

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

      if (tile.elevation === 'ground') {
        geometries.push(buildGroundQuad(uv, worldX + col * half, worldZ + row * half, half, half));
      } else {
        const baseY = row === 0 ? halfWallHeight : 0;
        geometries.push(
          buildWallQuad(uv, worldX + col * half, baseY, centerZ, half, halfWallHeight),
        );
      }
    }
    return geometries;
  }

  const uv = tile.quads[0];
  if (!uv) return [];

  if (tile.elevation === 'ground') {
    return [buildGroundQuad(uv, worldX, worldZ, tileWorldSize, tileWorldSize)];
  }
  return [buildWallQuad(uv, worldX, 0, worldZ + tileWorldSize / 2, tileWorldSize, wallHeight)];
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

  const geometriesBySheet = new Map<TileSheetId, THREE.BufferGeometry[]>();
  for (const tile of chunk.tiles) {
    const geometries = geometriesBySheet.get(tile.sheet) ?? [];
    geometries.push(...buildTileGeometry(tile, tileWorldSize, wallHeight));
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
      buildShadowGeometry(shadow, tileWorldSize),
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
