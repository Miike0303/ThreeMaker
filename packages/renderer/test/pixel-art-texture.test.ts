import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configurePixelArtTexture, loadSheetTexture } from '../src/scene/pixel-art-texture.js';

describe('configurePixelArtTexture', () => {
  it('defaults mipmapped textures to one anisotropy sample when no maximum is supplied', () => {
    const texture = new THREE.Texture();
    texture.anisotropy = 8;

    configurePixelArtTexture(texture, { mipmaps: true });

    expect(texture.anisotropy).toBe(1);
  });

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

describe('loadSheetTexture', () => {
  it('preserves a null loader failure in the rejection diagnostic', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (_url, _onLoad, _onProgress, onError) => {
        onError?.(null);
        return new THREE.Texture();
      },
    );

    await expect(loadSheetTexture('/missing-sheet.png')).rejects.toHaveProperty('message', 'null');
  });

  it('wraps loader error events in an Error with the event diagnostic', async () => {
    const failure = new Event('error');
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (_url, _onLoad, _onProgress, onError) => {
        onError?.(failure);
        return new THREE.Texture();
      },
    );

    const resultPromise = loadSheetTexture('/missing-sheet.png');

    await expect(resultPromise).rejects.toBeInstanceOf(Error);
    await expect(resultPromise).rejects.toHaveProperty('message', String(failure));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with the loaded texture and applies the requested pixel-art configuration', async () => {
    let onLoad: ((texture: THREE.Texture) => void) | undefined;
    const texture = new THREE.Texture();
    const load = vi
      .spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, callback) => {
        onLoad = callback;
        return texture;
      });

    const resultPromise = loadSheetTexture('/sheet.png', {
      mipmaps: true,
      magFilter: THREE.LinearFilter,
      maxAnisotropy: 4,
    });

    expect(load).toHaveBeenCalledWith(
      '/sheet.png',
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
    onLoad?.(texture);

    await expect(resultPromise).resolves.toBe(texture);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.anisotropy).toBe(4);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it.each([
    ['an Error', new Error('sheet failed'), new Error('sheet failed')],
    ['a string', 'sheet failed', new Error('sheet failed')],
  ])('rejects with %s from the loader callback', async (_label, failure, expected) => {
    let onError: ((error: unknown) => void) | undefined;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (_url, _onLoad, _onProgress, callback) => {
        onError = callback;
        return new THREE.Texture();
      },
    );

    const resultPromise = loadSheetTexture('/sheet.png');
    onError?.(failure);

    await expect(resultPromise).rejects.toEqual(expected);
    if (failure instanceof Error) {
      await expect(resultPromise).rejects.toBe(failure);
    }
  });
});
