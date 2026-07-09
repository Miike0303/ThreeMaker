import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChunkBuildData } from '../src/geometry/types.js';
import { buildChunkGroup } from '../src/scene/build-chunk-group.js';

function makeChunk(overrides: Partial<ChunkBuildData> = {}): ChunkBuildData {
  return {
    chunkX: 0,
    chunkY: 0,
    tiles: [],
    ...overrides,
  };
}

describe('buildChunkGroup', () => {
  it('creates one merged mesh per distinct sheet used in the chunk', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 },
          elevation: 'ground',
        },
        {
          tileX: 0,
          tileY: 1,
          layerIndex: 0,
          sheet: 'C',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'ground',
        },
      ],
    });
    const materials = {
      B: new THREE.MeshBasicMaterial(),
      C: new THREE.MeshBasicMaterial(),
    };

    const group = buildChunkGroup(chunk, materials);

    expect(group.children).toHaveLength(2);
    const meshNames = group.children.map((child) => child.name).sort();
    expect(meshNames).toEqual(['chunk-0-0-B', 'chunk-0-0-C']);
  });

  it('merges same-sheet tiles into a single geometry with 4 vertices per tile', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 },
          elevation: 'ground',
        },
      ],
    });
    const materials = { B: new THREE.MeshBasicMaterial() };

    const group = buildChunkGroup(chunk, materials);

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute('position').count).toBe(8); // 2 tiles * 4 vertices
  });

  it('skips tiles whose sheet has no provided material instead of throwing', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'ground',
        },
      ],
    });

    const group = buildChunkGroup(chunk, {});

    expect(group.children).toHaveLength(0);
  });

  it('places a ground tile flat at y=0 and an upper tile standing up above y=0', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'ground',
        },
      ],
    });
    const groundGroup = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );
    const groundMesh = groundGroup.children[0] as THREE.Mesh;
    groundMesh.geometry.computeBoundingBox();
    const groundBox = groundMesh.geometry.boundingBox as THREE.Box3;
    // A flat ground plane has zero height (min.y === max.y === 0).
    expect(groundBox.min.y).toBeCloseTo(0);
    expect(groundBox.max.y).toBeCloseTo(0);

    const upperChunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          uv: { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
          elevation: 'upper',
        },
      ],
    });
    const upperGroup = buildChunkGroup(
      upperChunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );
    const upperMesh = upperGroup.children[0] as THREE.Mesh;
    upperMesh.geometry.computeBoundingBox();
    const upperBox = upperMesh.geometry.boundingBox as THREE.Box3;
    // A standing wall quad spans from the ground up to wallHeight.
    expect(upperBox.min.y).toBeCloseTo(0);
    expect(upperBox.max.y).toBeCloseTo(1);
  });
});
