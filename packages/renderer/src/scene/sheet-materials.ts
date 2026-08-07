import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { configurePixelArtTexture, type PixelArtTextureOptions } from './pixel-art-texture.js';

/**
 * Optional baked-lightmap inputs for sheet materials (C6 lighting). When
 * present, every sheet material of the call gets `lightMap` + intensity and
 * the lightmap texture is bound to UV channel 1 (`uv1` attribute).
 * Shadow material never receives a lightMap -- callers must not pass this
 * bag into `createShadowMaterial`.
 */
export interface SheetLightingOptions {
  readonly lightMap?: THREE.Texture;
  readonly lightMapIntensity?: number;
}

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
 *
 * `textureOptions` is forwarded to `configurePixelArtTexture` for every
 * sheet texture -- e.g. `{ mipmaps: true, maxAnisotropy }` for the HD-2D
 * "filtered environment" look (see `PixelArtTextureOptions.mipmaps`), which
 * tames the perspective aliasing/shimmer a purely nearest-filtered,
 * non-mipmapped tileset shows while walking. Defaults to the crisp
 * no-mipmap sprite configuration, unchanged from before this option
 * existed -- the art call on tileset filtering is the caller's to make.
 *
 * `lighting` is optional: when provided with a `lightMap`, every sheet
 * material of this call (one per-floor call site) gets that texture on
 * channel 1 (`uv1`) and `lightMapIntensity` (default 1). Omitted bag leaves
 * materials with `lightMap === null`, identical to pre-lighting behavior.
 */
export function createSheetMaterials(
  textures: Partial<Record<TileSheetId, THREE.Texture>>,
  textureOptions: PixelArtTextureOptions = {},
  lighting?: SheetLightingOptions,
): Partial<Record<TileSheetId, THREE.Material>> {
  const materialsBySheet: Partial<Record<TileSheetId, THREE.Material>> = {};
  if (lighting?.lightMap) {
    // three r184: lightmap samples UV channel `texture.channel` → attribute `uv1` when channel=1.
    lighting.lightMap.channel = 1;
  }
  for (const [sheet, texture] of Object.entries(textures) as [TileSheetId, THREE.Texture][]) {
    configurePixelArtTexture(texture, textureOptions);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
    });
    if (lighting?.lightMap) {
      material.lightMap = lighting.lightMap;
      material.lightMapIntensity = lighting.lightMapIntensity ?? 1;
    }
    materialsBySheet[sheet] = material;
  }
  return materialsBySheet;
}

/**
 * The shared shadow-pencil overlay material: RPG Maker corescript paints
 * shadow quarters as rgba(0,0,0,0.5). `depthWrite: false` keeps the
 * translucent overlay from occluding anything drawn after it.
 *
 * `polygonOffset` (negative factor/units, i.e. "pull toward the camera" in
 * clip space) is the actual fix for z-fighting flicker between this overlay
 * and the ground quad it sits just above: `build-chunk-group.ts` also lifts
 * the shadow geometry by a small world-space offset (`SHADOW_LIFT_FACTOR`),
 * but a *world-space* lift's effectiveness against z-fighting shrinks as
 * camera distance grows (depth-buffer precision is non-linear in view-space
 * Z), so a fixed small lift can still flicker at zoomed-out/steep angles.
 * `polygonOffset` biases the rasterized depth directly, in clip space, so it
 * stays effective regardless of camera distance -- confirmed supported by
 * three@0.184's WebGPU backend (`WebGPUPipelineUtils` maps
 * `polygonOffsetUnits`/`polygonOffsetFactor` to `depthBias`/
 * `depthBiasSlopeScale`), not just the legacy WebGL path.
 */
export function createShadowMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}
