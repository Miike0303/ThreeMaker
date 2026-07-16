/**
 * `disposeFloorTextures` (rpgm-whole-game-import fix, adversarial review):
 * the manifest 'g' map-cycle (`main.ts`) calls `loadAuthoredMap` fresh per
 * hop, which allocates a brand-new set of `THREE.Texture` instances every
 * time (`authored-map.ts`'s `resolveTileset` -- no cross-hop cache). Sessions
 * are built with `ownsTextures: false`, so `session.dispose()` never frees
 * them -- this is the function that does, called on the map being cycled
 * away from.
 */
import type * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { disposeFloorTextures } from '../src/floor-textures.js';

function fakeTexture(): THREE.Texture {
  return { dispose: vi.fn() } as unknown as THREE.Texture;
}

describe('disposeFloorTextures', () => {
  it('calls dispose() on every populated slot texture', () => {
    const a1 = fakeTexture();
    const b = fakeTexture();

    disposeFloorTextures({ A1: a1, B: b });

    expect(a1.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  it('skips an empty (falsy) slot entry without throwing', () => {
    const a1 = fakeTexture();

    expect(() => disposeFloorTextures({ A1: a1, B: undefined })).not.toThrow();
    expect(a1.dispose).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for an empty textures record', () => {
    expect(() => disposeFloorTextures({})).not.toThrow();
  });

  it('is a no-op for undefined (nothing loaded yet on the very first hop)', () => {
    expect(() => disposeFloorTextures(undefined)).not.toThrow();
  });
});
