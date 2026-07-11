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

  it('culls the interior face between wall tiles in different chunks (whole-map wallTileKeys, not chunk-local)', () => {
    // Chunk (0,0)'s wall tile sits at the chunk's east edge (chunkSize
    // defaults to 16, so tileX=15 is the last column); chunk (1,0)'s wall
    // tile is immediately across the border at tileX=16. Both chunks are
    // built (live) so their meshes can be compared.
    const chunkA: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [
        {
          tileX: 15,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    };
    const chunkB: ChunkBuildData = {
      chunkX: 1,
      chunkY: 0,
      tiles: [
        {
          tileX: 16,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    };
    const scene = new StreamingTilemapScene([chunkA, chunkB], { A4: new THREE.Texture() });

    scene.applyDiff({ toBuild: ['0,0', '1,0'], toDispose: [] });

    const meshA = scene.group.children
      .find((child) => child.name === 'chunk-0-0')
      ?.children.find((child) => child.name === 'chunk-0-0-A4') as THREE.Mesh;
    const meshB = scene.group.children
      .find((child) => child.name === 'chunk-1-0')
      ?.children.find((child) => child.name === 'chunk-1-0-A4') as THREE.Mesh;

    // 3 open sides + 1 cap per tile (not 4+1) -- the shared face across the
    // chunk border is suppressed on both sides.
    expect(meshA.geometry.getAttribute('position').count).toBe(4 * 4);
    expect(meshB.geometry.getAttribute('position').count).toBe(4 * 4);
    scene.dispose();
  });

  it('patchChunks rebuilds a live chunk in place with the new geometry (scoped live update)', () => {
    const scene = new StreamingTilemapScene([makeChunk(0, 0)], { B: new THREE.Texture() });
    scene.buildChunk('0,0');
    const originalMesh = scene.group.children[0]?.children[0] as THREE.Mesh;
    const disposeSpy = vi.spyOn(originalMesh.geometry, 'dispose');

    const patched: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 1, v1: 1 }],
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 1, v1: 1 }],
          elevation: 'ground',
        },
      ],
    };
    scene.patchChunks([patched]);

    expect(disposeSpy).toHaveBeenCalledTimes(1); // old geometry freed
    expect(scene.liveChunkCount).toBe(1); // still exactly one live chunk, rebuilt not duplicated
    const rebuiltMesh = scene.group.children[0]?.children[0] as THREE.Mesh;
    expect(rebuiltMesh.geometry.getAttribute('position').count).toBeGreaterThan(
      originalMesh.geometry.getAttribute('position').count,
    );
    scene.dispose();
  });

  it('patchChunks does not build a chunk that is not currently live (patched but out of streaming radius)', () => {
    const scene = new StreamingTilemapScene([makeChunk(0, 0), makeChunk(1, 0)], {
      B: new THREE.Texture(),
    });
    scene.buildChunk('0,0'); // only chunk 0,0 is live; 1,0 is patched data but never built

    scene.patchChunks([makeChunk(1, 0)]);

    expect(scene.liveChunkCount).toBe(1);
    expect(scene.group.children.map((child) => child.name)).toEqual(['chunk-0-0']);
    scene.dispose();
  });

  it('patchChunks recomputes wallTileKeys from the full updated data, culling the PATCHED chunk correctly even though only its own geometry is rebuilt', () => {
    const chunkA: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [] }; // starts empty at the border tile
    const chunkB: ChunkBuildData = {
      chunkX: 1,
      chunkY: 0,
      tiles: [
        {
          tileX: 16,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    };
    const scene = new StreamingTilemapScene([chunkA, chunkB], { A4: new THREE.Texture() });
    scene.applyDiff({ toBuild: ['0,0', '1,0'], toDispose: [] });

    const meshBBeforePatch = scene.group.children
      .find((child) => child.name === 'chunk-1-0')
      ?.children.find((child) => child.name === 'chunk-1-0-A4') as THREE.Mesh;
    // Built before chunk A's neighboring wall existed: an isolated wall
    // prism (5 quads: 4 sides + 1 cap), not yet culled against anything.
    expect(meshBBeforePatch.geometry.getAttribute('position').count).toBe(5 * 4);

    // Paint a matching wall tile onto chunk A's east border (tileX=15).
    // wallTileKeys is recomputed from the FULL chunk set (including chunk
    // B's already-live wall), so chunk A's OWN rebuilt geometry correctly
    // culls the shared face on its side, even though chunk B itself was
    // not included in this patch and is intentionally left un-rebuilt (see
    // patchChunks's doc comment -- the caller is responsible for including
    // any neighbor chunks whose rendered culling an edit could affect).
    const paintedChunkA: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [
        {
          tileX: 15,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    };
    scene.patchChunks([paintedChunkA]);

    const meshA = scene.group.children
      .find((child) => child.name === 'chunk-0-0')
      ?.children.find((child) => child.name === 'chunk-0-0-A4') as THREE.Mesh;
    const meshBAfterPatch = scene.group.children
      .find((child) => child.name === 'chunk-1-0')
      ?.children.find((child) => child.name === 'chunk-1-0-A4') as THREE.Mesh;

    expect(meshA.geometry.getAttribute('position').count).toBe(4 * 4); // culled: 3 sides + cap
    // Chunk B's mesh is untouched (stale) since it wasn't in this patch --
    // documents the real scoping contract, not a bug.
    expect(meshBAfterPatch.geometry.getAttribute('position').count).toBe(5 * 4);
    scene.dispose();
  });

  it('patchChunks is a safe no-op after dispose() and for an empty chunk list', () => {
    const scene = makeScene();
    scene.buildChunk('0,0');
    scene.dispose();

    expect(() => scene.patchChunks([makeChunk(0, 0)])).not.toThrow();
    expect(() => makeScene().patchChunks([])).not.toThrow();
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
