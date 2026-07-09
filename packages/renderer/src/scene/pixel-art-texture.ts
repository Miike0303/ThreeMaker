import * as THREE from 'three';

/**
 * Configures a loaded tileset sheet texture for crisp pixel-art rendering:
 * nearest-neighbor filtering (no blur when scaled) and no mipmaps (mipmapping
 * blurs hard tile edges at a distance, which HD-2D pixel art does not want).
 */
export function configurePixelArtTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Loads a tileset sheet image from `url` as a pixel-art-configured
 * `THREE.Texture`. Browser/DOM-only (uses `THREE.TextureLoader`, which loads
 * via an `Image`) -- not used by the pure geometry layer or its Node tests.
 */
export function loadSheetTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => resolve(configurePixelArtTexture(texture)),
      undefined,
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
