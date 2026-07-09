import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkBuildData, TileBuildData } from '../geometry/types.js';

export interface BuildChunkGroupOptions {
  /** World-space size of one tile edge, both on the ground plane and for a wall quad's width. Default 1. */
  readonly tileWorldSize?: number;
  /** World-space height of an extruded "upper layer" wall quad. Default equals `tileWorldSize`. */
  readonly wallHeight?: number;
}

/** Remaps a fresh `PlaneGeometry`'s default 0-1 UVs to the tile's UV rect in-place. */
function applyTileUv(geometry: THREE.PlaneGeometry, tile: TileBuildData): void {
  const uvAttribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
  uvAttribute.setXY(0, tile.uv.u0, tile.uv.v1);
  uvAttribute.setXY(1, tile.uv.u1, tile.uv.v1);
  uvAttribute.setXY(2, tile.uv.u0, tile.uv.v0);
  uvAttribute.setXY(3, tile.uv.u1, tile.uv.v0);
  uvAttribute.needsUpdate = true;
}

/**
 * Builds one tile's quad geometry, positioned in world space. Ground tiles
 * lie flat on the XZ plane at y=0; "upper layer" tiles stand up as a vertical
 * wall-like quad from y=0 to y=wallHeight.
 */
function buildTileGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  wallHeight: number,
): THREE.BufferGeometry {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;

  if (tile.elevation === 'ground') {
    const geometry = new THREE.PlaneGeometry(tileWorldSize, tileWorldSize);
    applyTileUv(geometry, tile);
    geometry.rotateX(-Math.PI / 2); // lie flat, facing +Y
    geometry.translate(worldX + tileWorldSize / 2, 0, worldZ + tileWorldSize / 2);
    return geometry;
  }

  const geometry = new THREE.PlaneGeometry(tileWorldSize, wallHeight);
  applyTileUv(geometry, tile);
  // Faces +Z (toward a camera looking down at the map from the south) and
  // stands with its base on the ground instead of being centered on it.
  geometry.translate(worldX + tileWorldSize / 2, wallHeight / 2, worldZ + tileWorldSize / 2);
  return geometry;
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
    geometries.push(buildTileGeometry(tile, tileWorldSize, wallHeight));
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

  return group;
}
