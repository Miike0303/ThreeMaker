import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { configurePixelArtTexture } from './pixel-art-texture.js';

/**
 * Builds the shared per-sheet tile materials, configuring each texture for
 * pixel art on the way. One material per sheet, reused by every chunk that
 * references the sheet -- chunk disposal must never touch these.
 *
 * Decorative RPG Maker sprites (statues, torches, chests...) are
 * non-rectangular cutouts on a transparent PNG background, and some of
 * those exporters leave arbitrary RGB (commonly opaque white) behind
 * fully-transparent (alpha=0) pixels -- verified in the Roseliam fixture by
 * decoding Dungeon_B.png directly: tile id 92's cell contains pixels
 * like rgba(255,255,255,0). Without `transparent: true`, three.js
 * ignores alpha and paints that raw white RGB opaquely, which is what
 * produced the solid white rectangles seen next to statue tiles.
 * `alphaTest` (not `transparent` blending) keeps hard, unblended tile
 * edges -- the right call for nearest-filtered pixel art, where soft
 * alpha blending would fuzz the crisp silhouette.
 *
 * `side: DoubleSide` additionally renders the same texture on a quad's
 * back face: upper-layer ("star") tiles are extruded as single
 * zero-thickness standing quads (see `build-chunk-group.ts`) with no
 * back/side geometry of their own, so from an unusual angle their
 * default-culled back face would otherwise show nothing. Ground quads
 * are unaffected (always viewed from above).
 */
export function createSheetMaterials(
  textures: Partial<Record<TileSheetId, THREE.Texture>>,
): Partial<Record<TileSheetId, THREE.Material>> {
  const materialsBySheet: Partial<Record<TileSheetId, THREE.Material>> = {};
  for (const [sheet, texture] of Object.entries(textures) as [TileSheetId, THREE.Texture][]) {
    configurePixelArtTexture(texture);
    materialsBySheet[sheet] = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
    });
  }
  return materialsBySheet;
}

/**
 * The shared shadow-pencil overlay material: RPG Maker corescript paints
 * shadow quarters as rgba(0,0,0,0.5). `depthWrite: false` keeps the
 * translucent overlay from occluding anything drawn after it.
 */
export function createShadowMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
}
