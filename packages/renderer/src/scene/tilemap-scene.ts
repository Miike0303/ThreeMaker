import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import type { ChunkBuildData } from '../geometry/types.js';
import { type BuildChunkGroupOptions, buildChunkGroup } from './build-chunk-group.js';
import { configurePixelArtTexture } from './pixel-art-texture.js';

export type TilemapSceneOptions = BuildChunkGroupOptions;

/**
 * Owns the full three.js side of a rendered tilemap: one merged mesh per
 * (chunk, sheet), one material per sheet, and the sheet textures passed in.
 *
 * Three.js does not garbage-collect GPU resources -- geometries, materials,
 * and textures must be disposed explicitly, which is what `dispose()` is
 * for. This class takes ownership of the `textures` passed to its
 * constructor: call `dispose()` when the tilemap is no longer shown (e.g.
 * before loading a different map) to free that GPU memory.
 */
export class TilemapScene {
  readonly group: THREE.Group;

  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[];
  private readonly ownedTextures: THREE.Texture[];
  private disposed = false;

  constructor(
    chunks: readonly ChunkBuildData[],
    textures: Partial<Record<TileSheetId, THREE.Texture>>,
    options: TilemapSceneOptions = {},
  ) {
    this.group = new THREE.Group();
    this.group.name = 'tilemap';

    const materialsBySheet: Partial<Record<TileSheetId, THREE.Material>> = {};
    for (const [sheet, texture] of Object.entries(textures) as [TileSheetId, THREE.Texture][]) {
      configurePixelArtTexture(texture);
      materialsBySheet[sheet as TileSheetId] = new THREE.MeshBasicMaterial({ map: texture });
    }
    this.ownedMaterials = Object.values(materialsBySheet);
    this.ownedTextures = Object.values(textures);

    for (const chunk of chunks) {
      const chunkGroup = buildChunkGroup(chunk, materialsBySheet, options);
      for (const child of chunkGroup.children) {
        if (child instanceof THREE.Mesh) this.ownedGeometries.push(child.geometry);
      }
      this.group.add(chunkGroup);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.disposed = true;
  }
}
