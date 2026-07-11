import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ChunkBuildData } from '../src/geometry/types.js';
import { StreamingTilemapScene } from '../src/scene/streaming-tilemap-scene.js';

function makeChunk(chunkX: number, chunkY: number): ChunkBuildData {
  return {
    chunkX,
    chunkY,
    tiles: [
      {
        tileX: chunkX * 2,
        tileY: chunkY * 2,
        layerIndex: 0,
        sheet: 'B',
        quads: [{ u0: 0, v0: 0, u1: 0.5, v1: 0.5 }],
        elevation: 'ground',
      },
    ],
  };
}

function makeScene(chunks: readonly ChunkBuildData[] = [makeChunk(0, 0), makeChunk(1, 0)]) {
  return new StreamingTilemapScene(chunks, { B: new THREE.Texture() });
}

describe('StreamingTilemapScene', () => {
  it('builds nothing up-front: the root group starts empty', () => {
    const scene = makeScene();

    expect(scene.group.children).toHaveLength(0);
    expect(scene.liveChunkCount).toBe(0);
    scene.dispose();
  });

  it('buildChunk adds exactly the requested chunk group, once', () => {
    const scene = makeScene();

    scene.buildChunk('0,0');
    scene.buildChunk('0,0'); // idempotent: no duplicate group

    expect(scene.group.children).toHaveLength(1);
    expect(scene.group.children[0]?.name).toBe('chunk-0-0');
    expect(scene.liveChunkCount).toBe(1);
    scene.dispose();
  });

  it('ignores chunk keys the map has no data for', () => {
    const scene = makeScene();

    scene.buildChunk('99,99');

    expect(scene.group.children).toHaveLength(0);
    expect(scene.liveChunkCount).toBe(0);
    scene.dispose();
  });

  it('disposeChunk removes the group and disposes only that chunk geometry, never shared materials/textures', () => {
    const texture = new THREE.Texture();
    const scene = new StreamingTilemapScene([makeChunk(0, 0), makeChunk(1, 0)], { B: texture });
    scene.buildChunk('0,0');
    scene.buildChunk('1,0');

    const chunk00 = scene.group.children.find((child) => child.name === 'chunk-0-0');
    const mesh = chunk00?.children[0] as THREE.Mesh;
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose');
    const materialSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    scene.disposeChunk('0,0');

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).not.toHaveBeenCalled();
    expect(textureSpy).not.toHaveBeenCalled();
    expect(scene.group.children.map((child) => child.name)).toEqual(['chunk-1-0']);
    expect(scene.liveChunkCount).toBe(1);

    // Disposing again (or a never-built key) is a safe no-op.
    expect(() => scene.disposeChunk('0,0')).not.toThrow();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('a disposed chunk can be rebuilt later (walking back into an area)', () => {
    const scene = makeScene();
    scene.buildChunk('0,0');
    scene.disposeChunk('0,0');

    scene.buildChunk('0,0');

    expect(scene.group.children).toHaveLength(1);
    expect(scene.liveChunkCount).toBe(1);
    scene.dispose();
  });

  it('applyDiff builds and disposes in one call', () => {
    const scene = makeScene();
    scene.applyDiff({ toBuild: ['0,0', '1,0'], toDispose: [] });
    expect(scene.liveChunkCount).toBe(2);

    scene.applyDiff({ toBuild: [], toDispose: ['0,0'] });

    expect(scene.group.children.map((child) => child.name)).toEqual(['chunk-1-0']);
    scene.dispose();
  });

  it('dispose() frees live chunk geometry, shared materials, and owned textures, and is safe to call twice', () => {
    const texture = new THREE.Texture();
    const scene = new StreamingTilemapScene([makeChunk(0, 0)], { B: texture });
    scene.buildChunk('0,0');
    const mesh = scene.group.children[0]?.children[0] as THREE.Mesh;
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose');
    const materialSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    scene.dispose();
    scene.dispose();

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('leaves caller-owned textures alive when ownsTextures is false (map switching)', () => {
    const texture = new THREE.Texture();
    const scene = new StreamingTilemapScene(
      [makeChunk(0, 0)],
      { B: texture },
      {
        ownsTextures: false,
      },
    );
    const textureSpy = vi.spyOn(texture, 'dispose');

    scene.dispose();

    expect(textureSpy).not.toHaveBeenCalled();
  });

  it('builds shadow overlay meshes lazily with the chunk they belong to', () => {
    const chunk: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [],
      shadows: [{ tileX: 0, tileY: 0, mask: 5 }],
    };
    const scene = new StreamingTilemapScene([chunk], {});

    scene.buildChunk('0,0');

    const shadowMesh = scene.group.children[0]?.children.find((child) =>
      child.name.endsWith('-shadow'),
    );
    expect(shadowMesh).toBeDefined();
    scene.dispose();
  });
});
