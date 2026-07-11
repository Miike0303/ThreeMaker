import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChunkBuildData, TileBuildData } from '../src/geometry/types.js';
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
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 }],
          elevation: 'ground',
        },
        {
          tileX: 0,
          tileY: 1,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
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
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 }],
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
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
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
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
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
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
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

  it('expands a 4-quad autotile ground tile into 4 quarter geometries covering the full tile footprint', () => {
    const fourQuads = [
      { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
      { u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 },
      { u0: 0, v0: 0.1, u1: 0.1, v1: 0.2 },
      { u0: 0.1, v0: 0.1, u1: 0.2, v1: 0.2 },
    ];
    const chunk = makeChunk({
      tiles: [
        { tileX: 0, tileY: 0, layerIndex: 0, sheet: 'B', quads: fourQuads, elevation: 'ground' },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // 4 quarter-quads * 4 vertices each -- draw-call count is unaffected
    // (still one merged mesh), but the geometry now carries 4x the vertices
    // of a plain tile.
    expect(geometry.getAttribute('position').count).toBe(16);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    // The 4 quarters still tile together into the full 1x1 footprint, not 4
    // separate smaller tiles floating at the origin.
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(1);
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(1);
  });

  it('builds one shadow mesh per chunk with one quarter-quad per set shadow bit', () => {
    const chunk = makeChunk({
      shadows: [
        { tileX: 0, tileY: 0, mask: 5 }, // bits 0+2: upper-left + lower-left
        { tileX: 1, tileY: 0, mask: 15 }, // all four quarters
      ],
    });

    const group = buildChunkGroup(
      chunk,
      {},
      { tileWorldSize: 1, shadowMaterial: new THREE.MeshBasicMaterial() },
    );

    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.name).toBe('chunk-0-0-shadow');
    // (2 + 4) quarter-quads * 4 vertices each.
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(24);
  });

  it('positions shadow quarters on the tile halves their bits address (TL,TR,BL,BR bit order)', () => {
    // Mask 5 = bits 0 and 2 = upper-left + lower-left: the tile's west half.
    const chunk = makeChunk({ shadows: [{ tileX: 2, tileY: 1, mask: 5 }] });

    const group = buildChunkGroup(
      chunk,
      {},
      { tileWorldSize: 1, shadowMaterial: new THREE.MeshBasicMaterial() },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    // West half of tile (2,1): x in [2, 2.5], z spanning the full tile [1, 2].
    expect(box.min.x).toBeCloseTo(2);
    expect(box.max.x).toBeCloseTo(2.5);
    expect(box.min.z).toBeCloseTo(1);
    expect(box.max.z).toBeCloseTo(2);
    // Lifted slightly above the ground plane so it never z-fights the tile.
    expect(box.min.y).toBeGreaterThan(0);
  });

  it('builds no shadow mesh without a shadow material or without shadow data', () => {
    const withDataOnly = buildChunkGroup(
      makeChunk({ shadows: [{ tileX: 0, tileY: 0, mask: 5 }] }),
      {},
    );
    expect(withDataOnly.children).toHaveLength(0);

    const withMaterialOnly = buildChunkGroup(
      makeChunk(),
      {},
      {
        shadowMaterial: new THREE.MeshBasicMaterial(),
      },
    );
    expect(withMaterialOnly.children).toHaveLength(0);
  });

  it('expands a 4-quad autotile upper tile into quarters still spanning the full wall footprint and height', () => {
    const fourQuads = [
      { u0: 0, v0: 0, u1: 0.1, v1: 0.1 },
      { u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 },
      { u0: 0, v0: 0.1, u1: 0.1, v1: 0.2 },
      { u0: 0.1, v0: 0.1, u1: 0.2, v1: 0.2 },
    ];
    const chunk = makeChunk({
      tiles: [
        { tileX: 0, tileY: 0, layerIndex: 0, sheet: 'B', quads: fourQuads, elevation: 'upper' },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute('position').count).toBe(16);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(1);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1);
  });
});

describe('buildChunkGroup wall prisms (A3/A4)', () => {
  function wallTile(x: number, y: number): TileBuildData {
    return {
      tileX: x,
      tileY: y,
      layerIndex: 0,
      sheet: 'A4',
      quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
      elevation: 'ground',
    };
  }

  it('renders an isolated wall tile as 4 side faces + a top cap (5 quads, 20 vertices)', () => {
    const chunk = makeChunk({ tiles: [wallTile(0, 0)] });

    const group = buildChunkGroup(
      chunk,
      { A4: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute('position').count).toBe(5 * 4);
  });

  it('draws no interior face between two adjacent wall tiles (each contributes 3 sides + a cap)', () => {
    const chunk = makeChunk({ tiles: [wallTile(0, 0), wallTile(1, 0)] });

    const group = buildChunkGroup(
      chunk,
      { A4: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // 2 tiles * (3 open sides + 1 cap) * 4 vertices, instead of 2*(4+1)*4 --
    // the shared east/west face between them is never drawn on either side.
    expect(geometry.getAttribute('position').count).toBe(2 * 4 * 4);
  });

  it('stands a wall prism up from y=0 to the default 2-tile MV3D wall height', () => {
    const chunk = makeChunk({ tiles: [wallTile(0, 0)] });

    const group = buildChunkGroup(
      chunk,
      { A4: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(2);
  });

  it('a plain (non-A3/A4) ground tile is unaffected -- still a single flat quad', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(4);
  });
});

describe('buildChunkGroup elevation (region-derived height + cliff faces)', () => {
  it('lifts an elevated ground tile flat quad to y = height * heightUnit', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
          height: 3,
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(3);
    expect(box.max.y).toBeCloseTo(3);
  });

  it('adds one cliff side face per cliffEdges entry, spanning from the neighbor height up to its own', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 2,
          tileY: 1,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
          height: 3,
          cliffEdges: [
            { edge: 'west', neighborHeight: 0 },
            { edge: 'north', neighborHeight: 1 },
          ],
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // 1 ground quad + 2 cliff faces, 4 vertices each.
    expect(geometry.getAttribute('position').count).toBe(3 * 4);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    // The taller (west) cliff face reaches all the way down to y=0.
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(3);
  });

  it('a ground tile with no cliffEdges has no extra faces beyond its own quad(s)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
          height: 2,
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(4);
  });
});
