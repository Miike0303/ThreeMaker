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
        quads: [{ u0: 0, v0: 0, u1: 0.5, v1: 0.5 }],
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

  it('configures every material as double-sided with alpha-tested cutout transparency', () => {
    // Regression test: decorative sprite sheets carry fully-transparent
    // (alpha=0) pixels with arbitrary opaque-looking RGB (e.g. white) baked
    // in. Without alphaTest, three.js ignores alpha and paints that raw RGB
    // as if opaque, showing solid color blobs where a tile should be
    // invisible. DoubleSide additionally covers an extruded upper-layer
    // quad's unlit back face.
    const chunks = [makeChunk(0, 0, 'B')];
    const scene = new TilemapScene(chunks, { B: new THREE.Texture() });

    const mesh = scene.group.children[0]?.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.alphaTest).toBeGreaterThan(0);
    scene.dispose();
  });

  it('renders shadow-pencil data as a translucent black overlay mesh', () => {
    const chunk: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [],
      shadows: [{ tileX: 0, tileY: 0, mask: 5 }],
    };

    const scene = new TilemapScene([chunk], {});

    const chunkGroup = scene.group.children[0];
    const shadowMesh = chunkGroup?.children.find((child) => child.name.endsWith('-shadow')) as
      | THREE.Mesh
      | undefined;
    expect(shadowMesh).toBeDefined();
    const material = shadowMesh?.material as THREE.MeshBasicMaterial;
    // Matches RPG Maker's corescript shadow color rgba(0,0,0,0.5); depthWrite
    // stays off so the translucent overlay never occludes later draws.
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.5);
    expect(material.depthWrite).toBe(false);
    expect(material.color.getHex()).toBe(0x000000);
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
