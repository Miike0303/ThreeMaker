import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ChunkBuildData } from '../src/geometry/types.js';
import {
  StreamingTilemapScene,
  stepRoomFadeOpacity,
} from '../src/scene/streaming-tilemap-scene.js';

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

/** A 2x2 map's `roomIdGrid` (row-major, `mapWidth=2`) with cell (0,0) in room 1 and cell (1,0) in room 2, cell (0,1)/(1,1) unauthored (0). */
function makeTwoRoomGrid(): { readonly roomIdGrid: Uint16Array; readonly mapWidth: number } {
  return { roomIdGrid: new Uint16Array([1, 2, 0, 0]), mapWidth: 2 };
}

function makeCarveTile(
  tileX: number,
  tileY: number,
  sheet: 'B' | 'C' = 'B',
): ChunkBuildData['tiles'][number] {
  return {
    tileX,
    tileY,
    layerIndex: 0,
    sheet,
    quads: [{ u0: 0, v0: 0, u1: 0.5, v1: 0.5 }],
    elevation: 'ground',
  };
}

describe('StreamingTilemapScene ceiling carve + fade (Slice 3b)', () => {
  it('ceilingCarve option produces carved room meshes alongside the normal chunk mesh', () => {
    const chunk: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [makeCarveTile(0, 0), makeCarveTile(1, 0)],
    };
    const scene = new StreamingTilemapScene(
      [chunk],
      { B: new THREE.Texture() },
      {
        ceilingCarve: makeTwoRoomGrid(),
      },
    );

    scene.buildChunk('0,0');

    const names = scene.group.children[0]?.children.map((child) => child.name) ?? [];
    expect(names).toContain('chunk-0-0-B-room-1');
    expect(names).toContain('chunk-0-0-B-room-2');
    scene.dispose();
  });

  it('material clone pool: create-on-first-use, reuse-on-repeat-key, dispose-on-scene-dispose', () => {
    // chunkA carries both a carved (room 1) tile and a roomless tile, so its
    // normal per-sheet mesh's material is the actual shared instance to
    // compare against. chunkB (a different chunk) also carves into room 1,
    // on the same sheet -- room 1 spans both chunks, same as a real room
    // straddling a chunk border.
    const chunkA: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [makeCarveTile(0, 0), makeCarveTile(1, 1)], // (1,1) -> roomIdGrid index 3 -> 0 (roomless)
    };
    const chunkB: ChunkBuildData = { chunkX: 0, chunkY: 1, tiles: [makeCarveTile(0, 2)] };
    // mapWidth=2, 3 rows: (0,0)=1, (1,0)=2, (0,1)=0, (1,1)=0, (0,2)=1 (same room as (0,0), cross-chunk), (1,2)=0.
    const roomIdGrid = new Uint16Array([1, 2, 0, 0, 1, 0]);
    const scene = new StreamingTilemapScene(
      [chunkA, chunkB],
      { B: new THREE.Texture() },
      {
        ceilingCarve: { roomIdGrid, mapWidth: 2 },
      },
    );

    scene.buildChunk('0,0');
    const chunkAGroup = scene.group.children.find((child) => child.name === 'chunk-0-0');
    const sharedMesh = chunkAGroup?.children.find(
      (child) => child.name === 'chunk-0-0-B',
    ) as THREE.Mesh;
    const meshA = chunkAGroup?.children.find(
      (child) => child.name === 'chunk-0-0-B-room-1',
    ) as THREE.Mesh;

    // Create-on-first-use: the carved mesh's material is NOT the shared per-sheet instance.
    expect(meshA.material).not.toBe(sharedMesh.material);

    scene.buildChunk('0,1');
    const meshB = scene.group.children
      .find((child) => child.name === 'chunk-0-1')
      ?.children.find((child) => child.name === 'chunk-0-1-B-room-1') as THREE.Mesh;

    // Reuse-on-repeat-key: same (sheet, roomId) pair across two different chunks shares one clone.
    expect(meshB.material).toBe(meshA.material);

    const disposeSpy = vi.spyOn(meshA.material as THREE.Material, 'dispose');
    scene.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('never mutates the shared per-sheet material when a room clone fades', () => {
    const chunk: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [makeCarveTile(0, 0), { ...makeCarveTile(1, 1), tileX: 1, tileY: 1 }], // (1,1) is roomless
    };
    const texture = new THREE.Texture();
    const scene = new StreamingTilemapScene(
      [chunk],
      { B: texture },
      {
        ceilingCarve: makeTwoRoomGrid(),
      },
    );
    scene.buildChunk('0,0');

    const sharedMesh = scene.group.children[0]?.children.find(
      (child) => child.name === 'chunk-0-0-B',
    ) as THREE.Mesh;
    const sharedMaterial = sharedMesh.material as THREE.Material;

    scene.setFadedRoom(1);
    scene.updateFade(10); // large dt: converges (and snaps) to target within one step

    expect(sharedMaterial.opacity).toBe(1);
    expect(sharedMaterial.transparent).toBe(false);
    expect(sharedMaterial.alphaTest).toBe(0.5);
    scene.dispose();
  });

  it('alphaTest/opacity state machine: opaque rest vs fading/faded, restoring rest exactly at opacity 1', () => {
    const chunk: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [makeCarveTile(0, 0)] };
    const scene = new StreamingTilemapScene(
      [chunk],
      { B: new THREE.Texture() },
      {
        ceilingCarve: makeTwoRoomGrid(),
      },
    );
    scene.buildChunk('0,0');
    const mesh = scene.group.children[0]?.children.find(
      (child) => child.name === 'chunk-0-0-B-room-1',
    ) as THREE.Mesh;
    const material = mesh.material as THREE.Material;

    // Initial (never faded) state: identical to the shared material's rest state.
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.5);
    expect(material.depthWrite).toBe(true);

    scene.setFadedRoom(1);
    scene.updateFade(0.01); // small step: mid-tween, opacity not yet at target

    expect(material.opacity).toBeLessThan(1);
    expect(material.opacity).toBeGreaterThan(0.15);
    // The GOTCHA this test guards: even mid-tween (opacity !== 1), the
    // faded alphaTest/transparent/depthWrite state must already be active --
    // NOT the opaque rest state, which would fully discard the fragment at
    // low opacity (texture alpha * opacity is multiplied before alphaTest).
    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBe(0);
    expect(material.depthWrite).toBe(false);

    scene.updateFade(10); // converge fully to the faded target
    expect(material.opacity).toBeCloseTo(0.15, 5);
    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBe(0);

    scene.setFadedRoom(null);
    scene.updateFade(10); // converge back to opaque rest
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.5);
    expect(material.depthWrite).toBe(true);
    scene.dispose();
  });

  it('clone isolation: fading room 1 never changes room 2 (same sheet, same chunk)', () => {
    const chunk: ChunkBuildData = {
      chunkX: 0,
      chunkY: 0,
      tiles: [makeCarveTile(0, 0), makeCarveTile(1, 0)],
    };
    const scene = new StreamingTilemapScene(
      [chunk],
      { B: new THREE.Texture() },
      {
        ceilingCarve: makeTwoRoomGrid(),
      },
    );
    scene.buildChunk('0,0');
    const room1Mesh = scene.group.children[0]?.children.find(
      (child) => child.name === 'chunk-0-0-B-room-1',
    ) as THREE.Mesh;
    const room2Mesh = scene.group.children[0]?.children.find(
      (child) => child.name === 'chunk-0-0-B-room-2',
    ) as THREE.Mesh;

    scene.setFadedRoom(1);
    scene.updateFade(10);

    expect((room1Mesh.material as THREE.Material).opacity).toBeCloseTo(0.15, 5);
    expect((room2Mesh.material as THREE.Material).opacity).toBe(1);
    expect((room2Mesh.material as THREE.Material).alphaTest).toBe(0.5);
    scene.dispose();
  });

  it('regression: a scene with no rooms creates no clones and setFadedRoom/updateFade are safe no-ops', () => {
    const chunk: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [makeCarveTile(0, 0)] };
    const scene = new StreamingTilemapScene([chunk], { B: new THREE.Texture() }); // no ceilingCarve option
    scene.buildChunk('0,0');

    const names = scene.group.children[0]?.children.map((child) => child.name) ?? [];
    expect(names).toEqual(['chunk-0-0-B']);
    expect(names.some((name) => name.includes('-room-'))).toBe(false);

    expect(() => scene.setFadedRoom(1)).not.toThrow();
    expect(() => scene.updateFade(1)).not.toThrow();
    scene.dispose();
  });
});

describe('stepRoomFadeOpacity (pure fade tween step)', () => {
  it('moves toward the target and snaps exactly onto it once close enough', () => {
    let opacity = 1;
    for (let i = 0; i < 200; i++) {
      opacity = stepRoomFadeOpacity(opacity, 0.15, 1 / 60);
      if (opacity === 0.15) break;
    }
    expect(opacity).toBe(0.15);
  });

  it('a single large-dt step converges to (numerically snaps onto) the target', () => {
    expect(stepRoomFadeOpacity(1, 0.15, 10)).toBe(0.15);
    expect(stepRoomFadeOpacity(0.15, 1, 10)).toBe(1);
  });

  it('does not overshoot: a small step stays strictly between current and target', () => {
    const next = stepRoomFadeOpacity(1, 0.15, 0.01);
    expect(next).toBeLessThan(1);
    expect(next).toBeGreaterThan(0.15);
  });
});
