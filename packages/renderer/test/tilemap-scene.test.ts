import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ChunkBuildData } from '../src/geometry/types.js';
import { TilemapScene } from '../src/scene/tilemap-scene.js';

function makeChunk(chunkX: number, chunkY: number, sheet: 'B' | 'C'): ChunkBuildData {
  return {
    chunkX,
    chunkY,
    tiles: [
      {
        tileX: 0,
        tileY: 0,
        layerIndex: 0,
        sheet,
        uv: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
        elevation: 'ground',
      },
    ],
  };
}

describe('TilemapScene', () => {
  it('builds one child group per chunk, added to a single root group', () => {
    const chunks = [makeChunk(0, 0, 'B'), makeChunk(1, 0, 'B')];
    const textures = { B: new THREE.Texture() };

    const scene = new TilemapScene(chunks, textures);

    expect(scene.group.children).toHaveLength(2);
    scene.dispose();
  });

  it('configures every provided texture for pixel-art rendering (nearest filter, no mipmaps)', () => {
    const chunks = [makeChunk(0, 0, 'B')];
    const texture = new THREE.Texture();
    texture.magFilter = THREE.LinearFilter;

    const scene = new TilemapScene(chunks, { B: texture });

    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    scene.dispose();
  });

  it('dispose() frees every geometry, material, and texture it owns and is safe to call twice', () => {
    const chunks = [makeChunk(0, 0, 'B'), makeChunk(0, 1, 'C')];
    const textures = { B: new THREE.Texture(), C: new THREE.Texture() };
    const scene = new TilemapScene(chunks, textures);

    const geometryDisposeSpies = scene.group.children
      .flatMap((chunkGroup) => chunkGroup.children)
      .map((mesh) => vi.spyOn((mesh as THREE.Mesh).geometry, 'dispose'));
    const materialDisposeSpies = scene.group.children
      .flatMap((chunkGroup) => chunkGroup.children)
      .map((mesh) => vi.spyOn((mesh as THREE.Mesh).material as THREE.Material, 'dispose'));
    const textureDisposeSpy = vi.spyOn(textures.B, 'dispose');

    scene.dispose();

    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(textureDisposeSpy).toHaveBeenCalledTimes(1);

    // Calling dispose() again must not throw or double-dispose.
    expect(() => scene.dispose()).not.toThrow();
    expect(textureDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
