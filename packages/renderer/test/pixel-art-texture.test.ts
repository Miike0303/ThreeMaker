import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configurePixelArtTexture } from '../src/scene/pixel-art-texture.js';

describe('configurePixelArtTexture', () => {
  it('defaults to the crisp sprite configuration: nearest filter, no mipmaps, no anisotropy', () => {
    const texture = new THREE.Texture();

    configurePixelArtTexture(texture);

    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.anisotropy).toBe(1);
  });

  it('opts into the filtered/mipmapped "environment" configuration when mipmaps is true', () => {
    // HD-2D convention: the environment (tileset) is filtered/mipmapped to
    // avoid perspective-minification shimmer, while magFilter stays nearest
    // so close-up tiles are still crisp.
    const texture = new THREE.Texture();

    configurePixelArtTexture(texture, { mipmaps: true, maxAnisotropy: 4 });

    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.anisotropy).toBe(4);
  });

  it('caps anisotropy at 8 even when the renderer reports a higher maximum', () => {
    const texture = new THREE.Texture();

    configurePixelArtTexture(texture, { mipmaps: true, maxAnisotropy: 16 });

    expect(texture.anisotropy).toBe(8);
  });

  it('ignores maxAnisotropy when mipmaps is false (nothing to filter between without mip levels)', () => {
    const texture = new THREE.Texture();

    configurePixelArtTexture(texture, { maxAnisotropy: 16 });

    expect(texture.anisotropy).toBe(1);
  });

  it('allows overriding magFilter independently of mipmaps', () => {
    const texture = new THREE.Texture();

    configurePixelArtTexture(texture, { mipmaps: true, magFilter: THREE.LinearFilter });

    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it('always sets sRGB color space and bumps the texture version (needsUpdate)', () => {
    const texture = new THREE.Texture();
    const versionBefore = texture.version;

    configurePixelArtTexture(texture);

    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    // `needsUpdate` is a write-only setter that increments `version` -- there
    // is no getter to read the flag back, so assert its actual effect.
    expect(texture.version).toBeGreaterThan(versionBefore);
  });
});
