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
      // Decorative RPG Maker sprites (statues, torches, chests...) are
      // non-rectangular cutouts on a transparent PNG background, and some of
      // those exporters leave arbitrary RGB (commonly opaque white) behind
      // fully-transparent (alpha=0) pixels -- verified in this fixture by
      // decoding Dungeon_B.png directly: tile id 92's cell contains pixels
      // like rgba(255,255,255,0). Without `transparent: true`, three.js
      // ignores alpha and paints that raw white RGB opaquely, which is what
      // produced the solid white rectangles seen next to statue tiles.
      // `alphaTest` (not `transparent` blending) keeps hard, unblended tile
      // edges -- the right call for nearest-filtered pixel art, where soft
      // alpha blending would fuzz the crisp silhouette.
      //
      // `side: DoubleSide` additionally renders the same texture on a quad's
      // back face: upper-layer ("star") tiles are extruded as single
      // zero-thickness standing quads (see `build-chunk-group.ts`) with no
      // back/side geometry of their own, so from an unusual angle their
      // default-culled back face would otherwise show nothing. Ground quads
      // are unaffected (always viewed from above).
      materialsBySheet[sheet as TileSheetId] = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      });
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
