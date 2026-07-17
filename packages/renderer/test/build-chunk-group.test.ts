import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeWallTileKeys } from '../src/geometry/elevation.js';
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

  it('stands a star tile\'s quad on its stack base tile, south of its own cell (MV3D "tileoffset" fix)', () => {
    // Star tile authored at (0,0) (e.g. a crystal's overhanging top half),
    // stacked on a ground base one row south -- matches Map007's real
    // crystal/pillar decor: a star tile at (x,y) with a plain ground tile at
    // (x,y+1). Its standing quad must render AT the base's cell, not its own.
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 5,
          tileY: 2,
          layerIndex: 3,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'upper',
          starStack: { baseTileY: 3, level: 0, baseHeight: 0, baseIsWall: false },
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

    // Anchored at tileX=5 (unchanged) but tileY=3 (the base, one south of
    // the star tile's own tileY=2), standing from y=0 to y=1. A star quad is
    // a single-sided billboard (zero Z-thickness, like the pre-fix
    // behavior) centered on the base tile's depth, i.e. z=3.5, not spanning
    // the full [3,4] footprint.
    expect(box.min.x).toBeCloseTo(5);
    expect(box.max.x).toBeCloseTo(6);
    expect(box.min.z).toBeCloseTo(3.5);
    expect(box.max.z).toBeCloseTo(3.5);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1);
  });

  it('stacks a taller star tile above the ones already standing on the same base (level > 0)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 3,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'upper',
          starStack: { baseTileY: 2, level: 1, baseHeight: 0, baseIsWall: false },
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

    // level 1 -> spans [1, 2] above the base, not [0, 1].
    expect(box.min.y).toBeCloseTo(1);
    expect(box.max.y).toBeCloseTo(2);
  });

  it('stacks a star tile above the wall-prism height when its base is an A3/A4 wall tile', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 3,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'upper',
          starStack: { baseTileY: 1, level: 0, baseHeight: 0, baseIsWall: true },
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallPrismHeight: 2 },
    );
    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;

    // The wall prism's cap sits at y=2 (default wallPrismHeight); the star
    // quad stacks on top of it, from y=2 to y=3.
    expect(box.min.y).toBeCloseTo(2);
    expect(box.max.y).toBeCloseTo(3);
  });

  it("falls back to the tile's own cell when starStack is absent (hand-built fixtures, pre-fix behavior)", () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 4,
          tileY: 4,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'upper',
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

    expect(box.min.z).toBeCloseTo(4.5);
    expect(box.max.z).toBeCloseTo(4.5);
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

  it('draws no interior face between two wall tiles in DIFFERENT chunks, given the whole-map wallTileKeys', () => {
    // Chunk (0,0) holds a wall tile at the chunk's east edge; chunk (1,0)
    // holds the adjacent wall tile just across the border. Built as two
    // separate `buildChunkGroup` calls (like the real per-chunk pipeline),
    // sharing one whole-map `wallTileKeys` computed from both chunks' tiles
    // together -- the fix for the chunk-local-only culling that let two
    // coplanar wall faces both draw at a chunk border (z-fighting flicker).
    const chunkA: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [wallTile(15, 0)] };
    const chunkB: ChunkBuildData = { chunkX: 1, chunkY: 0, tiles: [wallTile(16, 0)] };
    const wallTileKeys = computeWallTileKeys([...chunkA.tiles, ...chunkB.tiles]);
    const materials = { A4: new THREE.MeshBasicMaterial() };

    const groupA = buildChunkGroup(chunkA, materials, { tileWorldSize: 1, wallTileKeys });
    const groupB = buildChunkGroup(chunkB, materials, { tileWorldSize: 1, wallTileKeys });

    const meshA = groupA.children[0] as THREE.Mesh;
    const meshB = groupB.children[0] as THREE.Mesh;
    // Each tile contributes 3 open sides + 1 cap (not 4+1) -- the shared
    // east/west face across the chunk border is suppressed on both sides.
    expect((meshA.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(4 * 4);
    expect((meshB.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(4 * 4);
  });

  it('without wallTileKeys, falls back to chunk-local culling (each chunk only sees its own tiles)', () => {
    // Same cross-chunk layout as above, but built without the whole-map
    // wallTileKeys override -- each `buildChunkGroup` call only knows about
    // its own chunk's tile, so neither sees the other as a neighbor and both
    // draw all 4 side faces (the pre-fix, chunk-local-only behavior).
    const chunkA: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [wallTile(15, 0)] };
    const chunkB: ChunkBuildData = { chunkX: 1, chunkY: 0, tiles: [wallTile(16, 0)] };
    const materials = { A4: new THREE.MeshBasicMaterial() };

    const groupA = buildChunkGroup(chunkA, materials, { tileWorldSize: 1 });
    const groupB = buildChunkGroup(chunkB, materials, { tileWorldSize: 1 });

    const meshA = groupA.children[0] as THREE.Mesh;
    const meshB = groupB.children[0] as THREE.Mesh;
    expect((meshA.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(5 * 4);
    expect((meshB.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(5 * 4);
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

describe('buildChunkGroup layer-separation lift (z-fight bug fix)', () => {
  it('lifts each editable layer index by a tiny, distinct amount so 2+ ground tiles at the same cell never land perfectly coplanar', () => {
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
          tileX: 0,
          tileY: 0,
          layerIndex: 1,
          sheet: 'B',
          quads: [{ u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 }],
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
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const yValues = new Set<number>();
    for (let i = 0; i < position.count; i++) yValues.add(Number(position.getY(i).toFixed(6)));
    // 2 quads (4 vertices each), each internally flat -- but the two
    // DIFFERENT layers must land on two DIFFERENT Y values, or they are
    // perfectly coplanar (the real bug: which one wins the depth test
    // becomes floating-point noise that flickers as the camera moves).
    expect(yValues.size).toBe(2);
  });

  it('leaves layerIndex 0 at exactly y=0 (backward compatible with the pre-existing flat-ground behavior)', () => {
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
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    // toBeCloseTo, matching the pre-existing "places a ground tile flat at
    // y=0" test's own tolerance: `rotateX(-Math.PI / 2)` alone introduces
    // negligible floating-point noise (~1e-17) independent of this fix.
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(0);
  });

  it('lifts a deeper layer index by MORE than a shallower one, monotonically, and stays well below the shadow overlay lift (0.01 x tileWorldSize)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 1,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 3,
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
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    // layerIndex 1's quad sits at some small lift > 0; layerIndex 3's quad
    // (a separate tile, at x=1) sits higher still, and even the deepest
    // layer stays under the shadow overlay's own 0.01 lift.
    expect(box.min.y).toBeGreaterThan(0);
    expect(box.max.y).toBeGreaterThan(box.min.y);
    expect(box.max.y).toBeLessThan(0.01);
  });
});

describe('buildChunkGroup upright object tiles (HD-2D squashed-furniture bug fix)', () => {
  it('renders an "object"-elevation tile as an upright standing quad, not a flat ground quad', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'object',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { C: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallHeight: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    // A flat ground quad would have min.y === max.y (zero height). An
    // upright quad spans from the ground up to wallHeight -- same shape as
    // the 'upper' star-tile branch (see "places a ground tile flat at y=0
    // and an upper tile standing up above y=0" above), reusing the SAME
    // upright-quad mechanism, not a second one.
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1);
  });

  it('anchors an "object" tile\'s base at its own region-derived elevation (height * heightUnit), same as a flat ground tile would', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'object',
          height: 2,
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { C: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallHeight: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(2);
    expect(box.max.y).toBeCloseTo(3);
  });

  it('separates two "object" tiles at the SAME cell on different layers along Z, not just Y (z-fight fix: table + item-on-table)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 1,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'object',
        },
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 2,
          sheet: 'C',
          quads: [{ u0: 0.1, v0: 0, u1: 0.2, v1: 0.1 }],
          elevation: 'object',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { C: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallHeight: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const zValues = new Set<number>();
    for (let i = 0; i < position.count; i++) zValues.add(Number(position.getZ(i).toFixed(6)));
    // Two vertical quads at the identical (x, y) cell, on different layers,
    // must land on 2 DISTINCT Z planes -- Y-based layerLift cannot separate
    // a vertical quad from itself (it shifts the whole plane up, not apart
    // along its own normal); the fix must offset along Z instead.
    expect(zValues.size).toBe(2);
  });

  it('leaves a layerIndex-0 "object" tile at the un-shifted Z center (backward compatible)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'object',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { C: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallHeight: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    // Center Z for a 1x1 tile at (0,0) with no layer shift is 0.5.
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0.5);
  });

  it('a passable (elevation: ground) object-sheet tile still renders as a flat quad (decals/rugs unaffected)', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { C: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, wallHeight: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(0);
  });
});

describe('buildChunkGroup ramp geometry (Slice 2b)', () => {
  /** Finds the vertex index whose (x,z) matches, within tolerance, so assertions can target a specific corner regardless of buffer layout. */
  function findVertexIndex(
    position: THREE.BufferAttribute,
    x: number,
    z: number,
  ): number | undefined {
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i) - x) < 1e-6 && Math.abs(position.getZ(i) - z) < 1e-6) {
        return i;
      }
    }
    return undefined;
  }

  function rampTile(overrides: Partial<TileBuildData> = {}): TileBuildData {
    return {
      tileX: 0,
      tileY: 0,
      layerIndex: 0,
      sheet: 'B',
      quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
      elevation: 'ground',
      height: 3,
      ramp: { direction: 'south', highHeight: 3, lowHeight: 2 },
      ...overrides,
    };
  }

  it('renders a ramp tile as one inclined quad whose corner Y values follow the downhill direction (Inclined quad)', () => {
    const chunk = makeChunk({ tiles: [rampTile()] });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const position = (mesh.geometry as THREE.BufferGeometry).getAttribute(
      'position',
    ) as THREE.BufferAttribute;

    // South ramp: north corners (z=0) stay at the tile's own height (3);
    // south corners (z=1) sit one level down (2) -- exactly the corner
    // heights `surfaceHeightAt` would report for this cell.
    const nw = findVertexIndex(position, 0, 0);
    const ne = findVertexIndex(position, 1, 0);
    const sw = findVertexIndex(position, 0, 1);
    const se = findVertexIndex(position, 1, 1);
    expect(nw).toBeDefined();
    expect(ne).toBeDefined();
    expect(sw).toBeDefined();
    expect(se).toBeDefined();

    expect(position.getY(nw as number)).toBeCloseTo(3);
    expect(position.getY(ne as number)).toBeCloseTo(3);
    expect(position.getY(sw as number)).toBeCloseTo(2);
    expect(position.getY(se as number)).toBeCloseTo(2);
  });

  it('renders a ramp tile as one inclined quad for an east/west direction too', () => {
    const chunk = makeChunk({
      tiles: [rampTile({ ramp: { direction: 'east', highHeight: 5, lowHeight: 4 } })],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const position = (mesh.geometry as THREE.BufferGeometry).getAttribute(
      'position',
    ) as THREE.BufferAttribute;

    // East ramp: west corners (x=0) stay high (5); east corners (x=1) sit
    // one level down (4).
    const nw = findVertexIndex(position, 0, 0);
    const ne = findVertexIndex(position, 1, 0);
    const sw = findVertexIndex(position, 0, 1);
    const se = findVertexIndex(position, 1, 1);

    expect(position.getY(nw as number)).toBeCloseTo(5);
    expect(position.getY(sw as number)).toBeCloseTo(5);
    expect(position.getY(ne as number)).toBeCloseTo(4);
    expect(position.getY(se as number)).toBeCloseTo(4);
  });

  it("adds 2 triangular skirt faces (3 vertices each) on the ramp's perpendicular edges", () => {
    const chunk = makeChunk({ tiles: [rampTile()] });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // 1 inclined quad (4 vertices) + 2 triangular skirts (3 vertices each).
    expect(geometry.getAttribute('position').count).toBe(4 + 3 + 3);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    // The skirts span the same [lowHeight, highHeight] range as the slope.
    expect(box.min.y).toBeCloseTo(2);
    expect(box.max.y).toBeCloseTo(3);
  });

  it('a non-ramp tile gets no skirt faces (0 extra vertices)', () => {
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
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    expect((mesh.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(4);
  });

  it("suppresses the cliff face on the ramp's own downhill edge (no coplanar overlap) but keeps a cliff face on an unrelated edge", () => {
    const chunk = makeChunk({
      tiles: [
        rampTile({
          cliffEdges: [
            { edge: 'south', neighborHeight: 2 }, // matches ramp.direction -- suppressed
            { edge: 'north', neighborHeight: 1 }, // unrelated edge -- kept
          ],
        }),
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // 1 inclined quad (4) + 2 skirts (3 each) + 1 surviving cliff face (4).
    // The 'south' cliffEdges entry contributes NOTHING (suppressed).
    expect(geometry.getAttribute('position').count).toBe(4 + 3 + 3 + 4);
  });

  it("keeps a ramp tile's low edge coplanar with an adjacent flat tile built in a DIFFERENT chunk (seam at ramp-cliff junction)", () => {
    // Chunk A: the ramp tile at (0,0), south-facing, 3 -> 2. Chunk B: the
    // flat downhill neighbor at (0,1), height 2 -- built as a SEPARATE
    // buildChunkGroup call, like real adjacent chunks (274dfec's shared-edge
    // convention: no special-casing needed, both sides derive the same
    // world-space Y from their own per-tile data).
    const chunkA: ChunkBuildData = { chunkX: 0, chunkY: 0, tiles: [rampTile()] };
    const chunkB: ChunkBuildData = {
      chunkX: 0,
      chunkY: 1,
      tiles: [
        {
          tileX: 0,
          tileY: 1,
          layerIndex: 0,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
          height: 2,
        },
      ],
    };
    const materials = { B: new THREE.MeshBasicMaterial() };

    const groupA = buildChunkGroup(chunkA, materials, { tileWorldSize: 1, heightUnit: 1 });
    const groupB = buildChunkGroup(chunkB, materials, { tileWorldSize: 1, heightUnit: 1 });

    const positionA = (
      (groupA.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry
    ).getAttribute('position') as THREE.BufferAttribute;
    const positionB = (
      (groupB.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry
    ).getAttribute('position') as THREE.BufferAttribute;

    const rampSouthEdgeIndex = findVertexIndex(positionA, 0, 1);
    const flatNorthEdgeIndex = findVertexIndex(positionB, 0, 1);
    expect(rampSouthEdgeIndex).toBeDefined();
    expect(flatNorthEdgeIndex).toBeDefined();
    expect(positionA.getY(rampSouthEdgeIndex as number)).toBeCloseTo(
      positionB.getY(flatNorthEdgeIndex as number),
    );
  });
});

describe('buildChunkGroup ramp skirt UV winding correctness (gate-fix)', () => {
  /**
   * Exact (x,y,z) match -- unlike `findVertexIndex` (x,z only), this also
   * checks Y, because a ramp skirt's downhill corner exists at TWO
   * different heights (the skirt's own high-side vertex and its low-side
   * vertex), and the main quad's own corner at that same (x,z) always sits
   * at the LOW height there -- so matching on Y too is what isolates the
   * skirt-only "high" vertex unambiguously from the main quad's vertex.
   */
  function findVertexIndexXYZ(
    position: THREE.BufferAttribute,
    x: number,
    y: number,
    z: number,
  ): number | undefined {
    for (let i = 0; i < position.count; i++) {
      if (
        Math.abs(position.getX(i) - x) < 1e-6 &&
        Math.abs(position.getY(i) - y) < 1e-6 &&
        Math.abs(position.getZ(i) - z) < 1e-6
      ) {
        return i;
      }
    }
    return undefined;
  }

  function rampTile(overrides: Partial<TileBuildData> = {}): TileBuildData {
    return {
      tileX: 0,
      tileY: 0,
      layerIndex: 0,
      sheet: 'B',
      quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
      elevation: 'ground',
      height: 3,
      ramp: { direction: 'south', highHeight: 3, lowHeight: 2 },
      ...overrides,
    };
  }

  it("keeps the west skirt's downhill-high vertex on the high (v1) UV row for a south ramp, whose west skirt needs its winding auto-corrected", () => {
    const chunk = makeChunk({ tiles: [rampTile()] }); // south, highHeight=3, lowHeight=2
    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );
    const geometry = (group.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;

    // West skirt of a south ramp: the downhill corner (sw) at the ramp's
    // HIGH height -- this position exists ONLY on the skirt triangle (the
    // main quad's own sw corner sits at lowY=2, not highY=3, there).
    const highDownhillIdx = findVertexIndexXYZ(position, 0, 3, 1);
    expect(highDownhillIdx).toBeDefined();

    // This vertex sits at the ramp's HIGH height, so it must carry the
    // "high" V coordinate (v1 = 0.1) -- regardless of which winding order
    // this particular triangle needed to face outward correctly.
    expect(uvAttr.getX(highDownhillIdx as number)).toBeCloseTo(0.1);
    expect(uvAttr.getY(highDownhillIdx as number)).toBeCloseTo(0.1);
  });

  it("keeps the east skirt's downhill-high vertex on the high (v1) UV row for a north ramp -- the opposite winding-flip case from the south ramp's west skirt above", () => {
    const chunk = makeChunk({
      tiles: [rampTile({ ramp: { direction: 'north', highHeight: 3, lowHeight: 2 } })],
    });
    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );
    const geometry = (group.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;

    // East skirt of a north ramp: the downhill corner (ne) at the ramp's
    // HIGH height -- again, unique to the skirt (the main quad's own ne
    // corner sits at lowY=2 for a north ramp).
    const highDownhillIdx = findVertexIndexXYZ(position, 1, 3, 0);
    expect(highDownhillIdx).toBeDefined();

    expect(uvAttr.getX(highDownhillIdx as number)).toBeCloseTo(0.1);
    expect(uvAttr.getY(highDownhillIdx as number)).toBeCloseTo(0.1);
  });
});

describe('buildChunkGroup golden regression guard (no ramps, gate-fix hardening)', () => {
  it('renders a flat + cliff + wall (no-ramp) fixture with byte-identical merged vertex-position and UV arrays (protects Slices 3-4 from unintended non-ramp geometry drift)', () => {
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
          height: 2,
          cliffEdges: [{ edge: 'west', neighborHeight: 0 }],
        },
        {
          tileX: 2,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
      ],
    });

    const group = buildChunkGroup(
      chunk,
      { B: new THREE.MeshBasicMaterial(), A4: new THREE.MeshBasicMaterial() },
      { tileWorldSize: 1, heightUnit: 1 },
    );

    const meshByName = Object.fromEntries(
      group.children.map((child) => [child.name, child as THREE.Mesh]),
    );
    const bGeometry = meshByName['chunk-0-0-B']?.geometry as THREE.BufferGeometry;
    const wallGeometry = meshByName['chunk-0-0-A4']?.geometry as THREE.BufferGeometry;
    expect(bGeometry).toBeDefined();
    expect(wallGeometry).toBeDefined();

    /** Rounds to 6 decimal places, absorbing Float32/trig noise (e.g. `computeVertexNormals`'s ~1e-17 residue) and normalizing -0 to 0, without masking any real geometry drift. */
    const round = (values: ArrayLike<number>): number[] =>
      Array.from(values, (value) => Math.round(value * 1e6) / 1e6 || 0);

    // Golden arrays captured once from this exact fixture on the
    // already-verified pre-gate-fix geometry pipeline (flat quad + elevated
    // quad + 1 cliff face for the B sheet; isolated wall prism -- 4 sides +
    // 1 cap -- for the A4 sheet). A future change that alters non-ramp
    // vertex or UV generation for ANY of these tile kinds will fail this
    // test, even though no ramp is involved.
    expect(round(bGeometry.getAttribute('position').array)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 2, 0, 2, 2, 0, 1, 2, 1, 2, 2, 1, 1, 2, 0, 1, 2, 1, 1,
      0, 0, 1, 0, 1,
    ]);
    expect(round(bGeometry.getAttribute('uv').array)).toEqual([
      0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0, 0.1, 0.1, 0.2, 0.1, 0.1, 0, 0.2, 0, 0.1, 0.1, 0.2, 0.1, 0.1,
      0, 0.2, 0,
    ]);
    expect(round(wallGeometry.getAttribute('position').array)).toEqual([
      3, 2, 0, 2, 2, 0, 3, 0, 0, 2, 0, 0, 2, 2, 1, 3, 2, 1, 2, 0, 1, 3, 0, 1, 3, 2, 1, 3, 2, 0, 3,
      0, 1, 3, 0, 0, 2, 2, 0, 2, 2, 1, 2, 0, 0, 2, 0, 1, 2, 2, 0, 3, 2, 0, 2, 2, 1, 3, 2, 1,
    ]);
    expect(round(wallGeometry.getAttribute('uv').array)).toEqual([
      0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1,
      0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0.1, 0,
    ]);
  });
});

describe('buildChunkGroup ceiling carve buckets (Slice 3a)', () => {
  function meshByName(group: THREE.Group): Record<string, THREE.Mesh> {
    return Object.fromEntries(group.children.map((child) => [child.name, child as THREE.Mesh]));
  }

  it('routes a tile with a non-zero roomId into a separate (sheet, roomId) bucket mesh named chunk-x-y-{sheet}-room-{id}', () => {
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
    // Tile (0,0) belongs to room 1; tile (1,0) is unauthored (0).
    const roomIdGrid = new Uint16Array([1, 0]);
    const materials = { B: new THREE.MeshBasicMaterial() };

    const group = buildChunkGroup(chunk, materials, {
      tileWorldSize: 1,
      ceilingCarve: { roomIdGrid, mapWidth: 2 },
    });

    const names = group.children.map((child) => child.name).sort();
    expect(names).toEqual(['chunk-0-0-B', 'chunk-0-0-B-room-1']);

    const byName = meshByName(group);
    const carvedGeometry = byName['chunk-0-0-B-room-1']?.geometry as THREE.BufferGeometry;
    const normalGeometry = byName['chunk-0-0-B']?.geometry as THREE.BufferGeometry;
    // The carved bucket holds only the room-1 tile's single quad (4 vertices),
    // not both tiles merged together.
    expect(carvedGeometry.getAttribute('position').count).toBe(4);
    // The normal per-sheet mesh holds only the unauthored (roomId 0) tile.
    expect(normalGeometry.getAttribute('position').count).toBe(4);
  });

  it('excludes roomId-0 (unauthored) tiles from carving entirely, producing output byte-identical to no ceilingCarve option at all', () => {
    const tiles: TileBuildData[] = [
      {
        tileX: 0,
        tileY: 0,
        layerIndex: 0,
        sheet: 'B',
        quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
        elevation: 'ground',
        height: 2,
        cliffEdges: [{ edge: 'west', neighborHeight: 0 }],
      },
      {
        tileX: 1,
        tileY: 0,
        layerIndex: 0,
        sheet: 'A4',
        quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
        elevation: 'ground',
      },
    ];
    const chunk = makeChunk({ tiles });
    const materials = { B: new THREE.MeshBasicMaterial(), A4: new THREE.MeshBasicMaterial() };

    const baseline = buildChunkGroup(chunk, materials, { tileWorldSize: 1, heightUnit: 1 });
    // All-zero roomIdGrid -- a map with no rooms authored -- must carve nothing.
    const roomIdGrid = new Uint16Array(2);
    const carved = buildChunkGroup(chunk, materials, {
      tileWorldSize: 1,
      heightUnit: 1,
      ceilingCarve: { roomIdGrid, mapWidth: 2 },
    });

    const baselineNames = baseline.children.map((child) => child.name).sort();
    const carvedNames = carved.children.map((child) => child.name).sort();
    // Zero carve buckets created -- same mesh set as the baseline.
    expect(carvedNames).toEqual(baselineNames);
    expect(carvedNames.some((name) => name.includes('-room-'))).toBe(false);

    const baselineByName = meshByName(baseline);
    const carvedByName = meshByName(carved);
    for (const name of baselineNames) {
      const baseGeometry = baselineByName[name]?.geometry as THREE.BufferGeometry;
      const carvedGeometry = carvedByName[name]?.geometry as THREE.BufferGeometry;
      expect(Array.from(carvedGeometry.getAttribute('position').array)).toEqual(
        Array.from(baseGeometry.getAttribute('position').array),
      );
      expect(Array.from(carvedGeometry.getAttribute('uv').array)).toEqual(
        Array.from(baseGeometry.getAttribute('uv').array),
      );
    }
  });

  it('never carves upper-layer, wall-sheet (A3/A4), or upright object tiles even when their cell has a non-zero roomId', () => {
    const chunk = makeChunk({
      tiles: [
        {
          tileX: 0,
          tileY: 0,
          layerIndex: 3,
          sheet: 'B',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'upper',
        },
        {
          tileX: 1,
          tileY: 0,
          layerIndex: 0,
          sheet: 'A4',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'ground',
        },
        {
          tileX: 0,
          tileY: 1,
          layerIndex: 0,
          sheet: 'C',
          quads: [{ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }],
          elevation: 'object',
        },
      ],
    });
    // Every cell authored as room 1 -- but upper/wall/object tiles must never carve.
    const roomIdGrid = new Uint16Array([1, 1, 1, 1]);
    const materials = {
      B: new THREE.MeshBasicMaterial(),
      A4: new THREE.MeshBasicMaterial(),
      C: new THREE.MeshBasicMaterial(),
    };

    const group = buildChunkGroup(chunk, materials, {
      tileWorldSize: 1,
      ceilingCarve: { roomIdGrid, mapWidth: 2 },
    });

    const names = group.children.map((child) => child.name).sort();
    expect(names).toEqual(['chunk-0-0-A4', 'chunk-0-0-B', 'chunk-0-0-C']);
  });
});
