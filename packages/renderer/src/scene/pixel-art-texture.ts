import * as THREE from 'three';

/** Anisotropic filtering never needs more samples than this in practice; also a sane cap for a GPU that reports a huge max. */
const MAX_ANISOTROPY_CAP = 8;

export interface PixelArtTextureOptions {
  /**
   * Generate mipmaps and minify with `LinearMipmapLinearFilter` instead of
   * plain `NearestFilter`. HD-2D convention (Octopath Traveler): the tileset
   * *environment* is filtered/mipmapped so it doesn't shimmer/alias under
   * perspective minification while walking, while *character* sprites stay
   * fully crisp (nearest, no mipmaps) so they read as flat pixel art.
   * Default `false` (the sprite behavior) -- opt in per texture use.
   *
   * ponytail: `generateMipmaps` box-filters the *whole shared atlas image*
   * per mip level, with no concept of the per-tile boundaries `tile-uv.ts`
   * carves out of it -- at a coarse enough mip level, a texel is already an
   * average that blended across two unrelated tiles, and no runtime UV
   * inset (see `TILE_UV_INSET_PX` in `tile-uv.ts`) can undo that after the
   * fact. Bumping that inset is today's cheap mitigation (real margin at the
   * mip levels this app's camera distances actually reach); the full fix is
   * padding a duplicated-edge border around each tile in the source atlas
   * before mip generation (or hand-building a shorter, tile-aware mip
   * chain) -- a texture-pipeline change, out of scope for this slice.
   */
  readonly mipmaps?: boolean;
  /**
   * Magnification filter (used when the texture is shown larger than its
   * source pixels, i.e. up close). Defaults to `NearestFilter` regardless of
   * `mipmaps`, so close-up tiles stay crisply pixelated even once `mipmaps`
   * smooths out distant ones -- the whole point of splitting mag/min here.
   */
  readonly magFilter?: THREE.MagnificationTextureFilter;
  /**
   * Anisotropic filtering sample count, only meaningful when `mipmaps` is
   * true. Pass the renderer's own `renderer.getMaxAnisotropy()` -- this
   * function stays a pure, testable unit by not reaching for a renderer
   * itself, so the caller measures it and passes the number in. Internally
   * capped at `MAX_ANISOTROPY_CAP` (8): more never meaningfully improves a
   * 2D tileset and only costs bandwidth. Ignored (kept at 1, i.e. off) when
   * `mipmaps` is false -- anisotropy has nothing to filter between without
   * mip levels.
   */
  readonly maxAnisotropy?: number;
}

/**
 * Configures a loaded tileset sheet texture for pixel-art rendering. By
 * default this is the crisp "sprite" configuration: nearest-neighbor
 * filtering (no blur when scaled) and no mipmaps (mipmapping blurs hard tile
 * edges at a distance). Pass `{ mipmaps: true }` for the "environment"
 * configuration instead (see `PixelArtTextureOptions.mipmaps`).
 */
export function configurePixelArtTexture(
  texture: THREE.Texture,
  options: PixelArtTextureOptions = {},
): THREE.Texture {
  const { mipmaps = false, magFilter = THREE.NearestFilter, maxAnisotropy = 1 } = options;

  texture.magFilter = magFilter;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = mipmaps;
  texture.anisotropy = mipmaps ? Math.min(maxAnisotropy, MAX_ANISOTROPY_CAP) : 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Loads a tileset sheet image from `url` as a pixel-art-configured
 * `THREE.Texture`. Browser/DOM-only (uses `THREE.TextureLoader`, which loads
 * via an `Image`) -- not used by the pure geometry layer or its Node tests.
 */
export function loadSheetTexture(
  url: string,
  options: PixelArtTextureOptions = {},
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => resolve(configurePixelArtTexture(texture, options)),
      undefined,
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
