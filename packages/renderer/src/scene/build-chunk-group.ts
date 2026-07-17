import type { TileSheetId } from '@threemaker/importer-rpgm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EdgeDirection, RampData } from '../geometry/elevation.js';
import { computeOpenEdges, computeWallTileKeys, isWallSheet } from '../geometry/elevation.js';
import type { ChunkBuildData, ShadowBuildData, TileBuildData, UvRect } from '../geometry/types.js';

export interface BuildChunkGroupOptions {
  /** World-space size of one tile edge, both on the ground plane and for a wall quad's width. Default 1. */
  readonly tileWorldSize?: number;
  /** World-space height of an extruded "upper layer" (star-bit) standing quad. Default equals `tileWorldSize`. */
  readonly wallHeight?: number;
  /**
   * World-space height of one region-elevation step: a tile with region
   * height H has its floor at `y = H * heightUnit`. Default equals
   * `tileWorldSize` (one full tile-height per region step, the MV3D
   * convention).
   */
  readonly heightUnit?: number;
  /**
   * World-space height of an A3/A4 wall-autotile prism. Default
   * `2 * tileWorldSize` -- MV3D's zero-config wall height.
   */
  readonly wallPrismHeight?: number;
  /**
   * Shared material for the shadow-pencil overlay (typically black,
   * `transparent`, opacity 0.5, `depthWrite: false`). When omitted, shadow
   * data on the chunk is skipped -- same contract as a sheet with no
   * material.
   */
  readonly shadowMaterial?: THREE.Material;
  /**
   * Whole-map wall-tile occupancy (see `computeWallTileKeys`), used to cull
   * interior faces between adjacent A3/A4 wall prisms even when they sit in
   * different chunks. When omitted, falls back to this chunk's own tiles
   * only -- correct within a single chunk, but a wall tile at a chunk's edge
   * then always reports its border-facing sides as open, which can draw a
   * z-fighting interior face against a wall tile that actually continues in
   * the neighboring chunk. Callers building a whole map's worth of chunks
   * (`TilemapScene`, `StreamingTilemapScene`) always pass this.
   */
  readonly wallTileKeys?: ReadonlySet<string>;
  /**
   * Carves this chunk's ground-quad tiles (flat floor + their cliff/skirt
   * geometry) that fall inside a room's footprint into their own bucket mesh,
   * one per `(sheet, roomId)` pair -- the geometry half of the ceiling-carve
   * feature (design: "carve floor-above's ground-quad tiles over rooms-below
   * footprint into separate meshes per (chunk, sheet, roomId)"). `roomIdGrid`
   * is typically the FLOOR BELOW's room grid, passed to the floor ABOVE's
   * `buildChunkGroup` call, so the floor above gets carved into per-room
   * ceiling pieces.
   *
   * `roomIdGrid` value 0 means "no room" -- those cells are NEVER carved and
   * stay part of the normal per-sheet chunk mesh, unmodified (the
   * "unauthored areas never occlude" invariant, enforced here at the
   * geometry level). Only non-`upper`, non-wall-sheet (A3/A4) tiles are
   * carve-eligible; star-bit "upper layer" quads and wall prisms are never
   * carved regardless of their cell's room id, since the design scopes
   * ceiling carving to flat floor geometry only.
   *
   * This slice (3a) only buckets the GEOMETRY into separate meshes; each
   * bucket mesh still uses the SAME material instance as that sheet's normal
   * mesh (`materials[sheet]`). Per-room material cloning + fade is Slice 3b.
   */
  readonly ceilingCarve?: {
    /** Uint16Array, one entry per map cell (row-major, `y * mapWidth + x`); 0 = no room, else a 1-based room ordinal (see `computeRoomIdGrid`). */
    readonly roomIdGrid: Uint16Array;
    /** Full map width in tiles -- needed to index `roomIdGrid` from a tile's `(tileX, tileY)`. */
    readonly mapWidth: number;
  };
}

/** One (sheet, roomId) ceiling-carve bucket's accumulated (not-yet-merged) geometry, keyed by `${sheet}|${roomId}`. */
interface CarveBucket {
  readonly sheet: TileSheetId;
  readonly roomId: number;
  readonly geometries: THREE.BufferGeometry[];
}

/**
 * Fraction of a tile edge the shadow overlay floats above the ground plane,
 * so the coplanar translucent quads never z-fight the tiles beneath them.
 * Small enough to be invisible at the HD-2D camera tilt.
 */
const SHADOW_LIFT_FACTOR = 0.01;

/**
 * Fraction of a tile edge each editable tile LAYER (RPG Maker's 4 stacked
 * paintable layers per map, `TileBuildData.layerIndex` 0-3) is lifted above
 * the one below it, so 2+ ground tiles painted on DIFFERENT layers at the
 * SAME cell never render as perfectly coplanar quads.
 *
 * Real RPG Maker maps routinely paint more than one editable layer at the
 * same cell (a floor on layer 0, a rug/decal/lighting-overlay tile on layer
 * 1, and so on) -- corescript's own 2D painter's-algorithm renderer draws
 * layers strictly bottom-to-top with no depth buffer at all, so this can
 * never conflict there. This 3D renderer instead places every ground quad
 * at the SAME world Y (purely region-height-derived, identical regardless
 * of which editable layer a tile came from) -- without this per-layer lift,
 * two such quads are bit-for-bit coplanar, and which one wins the depth
 * test becomes floating-point-precision noise that visibly flickers as the
 * camera moves (bug report: "parpadeo en las texturas al moverme" --
 * confirmed by direct inspection of real map data: ~6% of a real
 * kingdom-of-subversion map's cells carry 2+ non-star tiles across
 * different layers, vs 0-1.7% in this repo's small/sparse dev fixtures,
 * which is why the fixture path read as "clean").
 *
 * Sized well below `SHADOW_LIFT_FACTOR` (0.01) even at the deepest editable
 * layer (index 3: `3 * 0.001 = 0.003`), so the shadow-pencil overlay still
 * unambiguously sits above every tile layer regardless of which one a
 * shadow mark's cell resolves to -- no new z-fight introduced between the
 * shadow overlay and a lifted upper layer. At `tileWorldSize` scale (1 world
 * unit per tile), a 0.001-0.003 unit vertical gap is imperceptible, the same
 * "small enough to be invisible" tradeoff `SHADOW_LIFT_FACTOR` already makes.
 */
const LAYER_LIFT_FACTOR = 0.001;

/** Full-rect UV for untextured overlay quads (the material has no map, values are irrelevant). */
const FULL_UV: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

/**
 * One quarter-size dark quad per set shadow bit, replicating corescript's
 * `Tilemap._addShadow` bit order: bit 0 = upper-left, 1 = upper-right,
 * 2 = lower-left, 3 = lower-right ("upper" being map-north / smaller tileY).
 */
function buildShadowGeometry(
  shadow: ShadowBuildData,
  tileWorldSize: number,
  heightUnit: number,
): THREE.BufferGeometry[] {
  const half = tileWorldSize / 2;
  const worldX = shadow.tileX * tileWorldSize;
  const worldZ = shadow.tileY * tileWorldSize;
  const lift = tileWorldSize * SHADOW_LIFT_FACTOR + (shadow.height ?? 0) * heightUnit;

  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    if ((shadow.mask & (1 << i)) === 0) continue;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const quad = buildGroundQuad(FULL_UV, worldX + col * half, worldZ + row * half, half, half);
    quad.translate(0, lift, 0);
    geometries.push(quad);
  }
  return geometries;
}

/** Remaps a fresh `PlaneGeometry`'s default 0-1 UVs to a UV rect in-place. */
function applyQuadUv(geometry: THREE.PlaneGeometry, uv: UvRect): void {
  const uvAttribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
  uvAttribute.setXY(0, uv.u0, uv.v1);
  uvAttribute.setXY(1, uv.u1, uv.v1);
  uvAttribute.setXY(2, uv.u0, uv.v0);
  uvAttribute.setXY(3, uv.u1, uv.v0);
  uvAttribute.needsUpdate = true;
}

/** One ground-plane sub-quad of world-space size `width` x `depth`, corner-positioned at (worldX, worldZ), lying at y=0 (callers translate for elevation). */
function buildGroundQuad(
  uv: UvRect,
  worldX: number,
  worldZ: number,
  width: number,
  depth: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, depth);
  applyQuadUv(geometry, uv);
  geometry.rotateX(-Math.PI / 2); // lie flat, facing +Y
  geometry.translate(worldX + width / 2, 0, worldZ + depth / 2);
  return geometry;
}

/**
 * One standing wall sub-quad of world-space size `width` x `height`, corner
 * positioned at (worldX, baseY) and centered at `centerZ` in depth (a wall
 * quad never subdivides in Z -- it is a flat billboard at the tile's depth
 * center regardless of how many quarters compose it). Only used for the
 * single-sided star-bit "upper layer" quad (faces +Z only); wall *prisms*
 * (A3/A4) use `buildSideFaceQuad` below, which can face any of the 4 edges.
 */
function buildWallQuad(
  uv: UvRect,
  worldX: number,
  baseY: number,
  centerZ: number,
  width: number,
  height: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height);
  applyQuadUv(geometry, uv);
  // Faces +Z (toward a camera looking down at the map from the south).
  geometry.translate(worldX + width / 2, baseY + height / 2, centerZ);
  return geometry;
}

// A PlaneGeometry's default normal is +Z; rotating around Y by these angles
// aims it outward across each of a tile's 4 edges (see `buildSideFaceQuad`).
const EDGE_ROTATION_Y: Record<EdgeDirection, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

// Fraction of a tile's footprint (0-1 in both x/z) where each edge's face
// sits, matching `EDGE_ROTATION_Y`'s outward direction.
const EDGE_CENTER_OFFSET: Record<EdgeDirection, { readonly x: number; readonly z: number }> = {
  south: { x: 0.5, z: 1 },
  north: { x: 0.5, z: 0 },
  east: { x: 1, z: 0.5 },
  west: { x: 0, z: 0.5 },
};

/**
 * One side-face quad on tile `(worldX, worldZ)`-`(worldX+tileWorldSize,
 * worldZ+tileWorldSize)`'s given edge, spanning `[baseY, baseY+faceHeight]`.
 * Shared by wall prisms (A3/A4) and cliff faces -- both are "a vertical quad
 * on one edge of a tile's footprint", differing only in which edges get one
 * and over what height range.
 */
function buildSideFaceQuad(
  uv: UvRect,
  edge: EdgeDirection,
  worldX: number,
  worldZ: number,
  tileWorldSize: number,
  baseY: number,
  faceHeight: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(tileWorldSize, faceHeight);
  applyQuadUv(geometry, uv);
  geometry.rotateY(EDGE_ROTATION_Y[edge]);
  const offset = EDGE_CENTER_OFFSET[edge];
  geometry.translate(
    worldX + offset.x * tileWorldSize,
    baseY + faceHeight / 2,
    worldZ + offset.z * tileWorldSize,
  );
  return geometry;
}

/**
 * A tile's elevated-ground cliff faces (one per `tile.cliffEdges` entry,
 * spanning from the neighbor's height up to the tile's own). Textured with
 * the tile's own first quad, stretched across the face -- a deliberately
 * lazy default (see the design notes in the elevation slice this shipped
 * with); a dedicated cliff texture is a future knob, not this slice.
 */
function buildCliffGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  heightUnit: number,
): THREE.BufferGeometry[] {
  const cliffEdges = tile.cliffEdges;
  if (!cliffEdges || cliffEdges.length === 0) return [];
  const uv = tile.quads[0];
  if (!uv) return [];

  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const ownHeight = tile.height ?? 0;

  const ramp = tile.ramp;
  const geometries: THREE.BufferGeometry[] = [];
  for (const { edge, neighborHeight } of cliffEdges) {
    // A ramp tile's own downhill edge is suppressed here -- the inclined
    // quad `applyRampSlope` builds already meets that neighbor's floor
    // exactly (both sides agree on the height there), so a separate
    // vertical face would be a redundant, coplanar-overlapping quad hanging
    // in front of the slope (design: "downhill cliff suppression"). Every
    // other edge (the flat uphill edge, or a perpendicular edge with an
    // even lower neighbor) is unaffected.
    if (ramp && edge === ramp.direction) continue;
    const faceHeight = (ownHeight - neighborHeight) * heightUnit;
    if (faceHeight <= 0) continue;
    const baseY = neighborHeight * heightUnit;
    geometries.push(buildSideFaceQuad(uv, edge, worldX, worldZ, tileWorldSize, baseY, faceHeight));
  }
  return geometries;
}

/** Outward-facing normal direction for each of a tile's 4 edges (matches the plane a `buildSideFaceQuad` on that edge would face, via `EDGE_ROTATION_Y`). */
const EDGE_OUTWARD_NORMAL: Record<EdgeDirection, THREE.Vector3> = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
};

/**
 * One triangular skirt face filling the gap between a ramp tile's sloped
 * edge and a flat neighbor sitting at the ramp's own (higher) height: the
 * edge's "uphill" corner already sits at that height (a degenerate,
 * zero-height point), and the "downhill" corner drops the full
 * `highY - lowY` -- see the design's "trapezoid/triangle skirts" note.
 * Vertex winding is chosen so the face's normal always points outward
 * (away from the ramp tile), regardless of which absolute corner happens to
 * be "up" for a given direction (see `buildRampSkirts`).
 *
 * The UV for the two downhill-corner vertices (`b`/`c`) is derived from
 * their SAME semantic height role (`b` = downhill corner at the high
 * height, `c` = downhill corner at the low height) that drives their
 * position, and is re-paired in lockstep whenever the winding swap above
 * reorders them into the buffer -- gate-fix for a bug where the UV stayed
 * hardcoded at a fixed buffer-slot order ([slot1, slot2] = [high, low])
 * while positions swapped slots for winding correction, silently inverting
 * the V axis on exactly one of a ramp's two skirt triangles.
 */
function buildRampSkirtTriangle(
  uv: UvRect,
  edge: EdgeDirection,
  cornerUp: readonly [number, number],
  cornerDown: readonly [number, number],
  highY: number,
  lowY: number,
): THREE.BufferGeometry {
  const a = new THREE.Vector3(cornerUp[0], highY, cornerUp[1]);
  const b = new THREE.Vector3(cornerDown[0], highY, cornerDown[1]);
  const c = new THREE.Vector3(cornerDown[0], lowY, cornerDown[1]);
  const uvB: readonly [number, number] = [uv.u1, uv.v1];
  const uvC: readonly [number, number] = [uv.u1, uv.v0];

  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const outward = normal.dot(EDGE_OUTWARD_NORMAL[edge]) >= 0;
  const [v1, v2] = outward ? [b, c] : [c, b];
  const [uv1, uv2] = outward ? [uvB, uvC] : [uvC, uvB];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([a.x, a.y, a.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array([uv.u0, uv.v1, uv1[0], uv1[1], uv2[0], uv2[1]]), 2),
  );
  // PlaneGeometry (used by every other quad this file builds) is indexed;
  // mergeGeometries requires ALL merged geometries to agree on that, so this
  // hand-built triangle needs an explicit index too, even though it's a
  // trivial 1:1 identity one.
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The 2 triangular skirt faces a ramp tile needs on its perpendicular edges
 * (the edges NOT aligned with the slope direction) -- see module doc. Each
 * fills the gap between the ramp's sloped edge and where a flat neighbor at
 * the ramp's own height would otherwise leave a vertical drop with no face:
 * `buildCliffGeometry` never generates this case, since both cells report
 * the SAME `heightGrid` value there (no cliff is flagged at all). Returns
 * `[]` for a tile with no `ramp` descriptor.
 *
 * ponytail: unconditional -- doesn't check whether the perpendicular
 * neighbor is itself an identically-directed ramp (parallel "wide stairs"),
 * which would need NO skirt (a continuous shared slope). That neighbor
 * lookup needs whole-map ramp data this per-tile function doesn't have;
 * gameplay's wide-stairs case (spec: "parallel identical ramps allowed") is
 * a passability rule, not a rendering requirement this slice's spec covers.
 */
function buildRampSkirts(
  tile: TileBuildData,
  tileWorldSize: number,
  heightUnit: number,
): THREE.BufferGeometry[] {
  const ramp = tile.ramp;
  if (!ramp) return [];
  const uv = tile.quads[0];
  if (!uv) return [];

  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const east = worldX + tileWorldSize;
  const south = worldZ + tileWorldSize;
  const highY = ramp.highHeight * heightUnit;
  const lowY = ramp.lowHeight * heightUnit;

  const nw: readonly [number, number] = [worldX, worldZ];
  const ne: readonly [number, number] = [east, worldZ];
  const sw: readonly [number, number] = [worldX, south];
  const se: readonly [number, number] = [east, south];

  switch (ramp.direction) {
    case 'south':
      return [
        buildRampSkirtTriangle(uv, 'west', nw, sw, highY, lowY),
        buildRampSkirtTriangle(uv, 'east', ne, se, highY, lowY),
      ];
    case 'north':
      return [
        buildRampSkirtTriangle(uv, 'west', sw, nw, highY, lowY),
        buildRampSkirtTriangle(uv, 'east', se, ne, highY, lowY),
      ];
    case 'east':
      return [
        buildRampSkirtTriangle(uv, 'north', nw, ne, highY, lowY),
        buildRampSkirtTriangle(uv, 'south', sw, se, highY, lowY),
      ];
    case 'west':
      return [
        buildRampSkirtTriangle(uv, 'north', ne, nw, highY, lowY),
        buildRampSkirtTriangle(uv, 'south', se, sw, highY, lowY),
      ];
  }
}

/**
 * The 4 tile-corner surface heights (nw, ne, sw, se), in tile-height units,
 * for a ramp descriptor -- mirrors importer-rpgm's private `cornerHeight`
 * logic (own height everywhere except the 2 corners on the downhill edge,
 * which sit one level below). Kept local since `TileBuildData.ramp` already
 * carries the resolved direction + both heights (see `rampDataAt` in
 * `elevation.ts`), so this file never needs the raw height/ramp grids.
 */
function rampCornerHeights(ramp: RampData): {
  readonly nw: number;
  readonly ne: number;
  readonly sw: number;
  readonly se: number;
} {
  const { direction, highHeight, lowHeight } = ramp;
  switch (direction) {
    case 'north':
      return { nw: lowHeight, ne: lowHeight, sw: highHeight, se: highHeight };
    case 'south':
      return { nw: highHeight, ne: highHeight, sw: lowHeight, se: lowHeight };
    case 'west':
      return { nw: lowHeight, ne: highHeight, sw: lowHeight, se: highHeight };
    case 'east':
      return { nw: highHeight, ne: lowHeight, sw: highHeight, se: lowHeight };
  }
}

/**
 * Bilinear-lifts a flat ground quad's vertices into the inclined surface a
 * ramp tile's `RampData` describes, instead of the uniform `elevationLift`
 * translate a flat tile gets. Works for both a plain tile's single
 * full-footprint quad and an autotile's 4 quarter quads: each vertex's
 * height is interpolated from the tile's 4 CORNER heights using its own
 * (u,v) fraction across the FULL tile footprint (`worldX`/`worldZ`/
 * `tileWorldSize` always describe the whole tile, even when `geometry` is
 * only one quarter of it) -- the same bilinear math importer-rpgm's
 * `surfaceHeightAt` uses, which is exactly linear here since a ramp's 4
 * corners always have 2 pairs sharing a height (see that module's doc).
 */
function applyRampSlope(
  geometry: THREE.BufferGeometry,
  ramp: RampData,
  worldX: number,
  worldZ: number,
  tileWorldSize: number,
  heightUnit: number,
): void {
  const { nw, ne, sw, se } = rampCornerHeights(ramp);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const u = (position.getX(i) - worldX) / tileWorldSize;
    const v = (position.getZ(i) - worldZ) / tileWorldSize;
    const top = nw * (1 - u) + ne * u;
    const bottom = sw * (1 - u) + se * u;
    position.setY(i, (top * (1 - v) + bottom * v) * heightUnit);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * A wall-autotile (A3/A4) tile's 3D prism: one side face per entry in
 * `openEdges` (the edges without a same-chunk wall-tile neighbor -- see
 * `computeOpenEdges`), textured with the tile's own first quad stretched
 * across the prism's height (same lazy-default choice as cliff faces), plus
 * a flat top cap reusing the tile's full quad composition (quarters for an
 * autotile) so an A4 floor-style top texture reads correctly.
 */
function buildWallPrismGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  wallPrismHeight: number,
  heightUnit: number,
  openEdges: readonly EdgeDirection[],
): THREE.BufferGeometry[] {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const baseY = (tile.height ?? 0) * heightUnit;
  const capY = baseY + wallPrismHeight;

  const geometries: THREE.BufferGeometry[] = [];

  const sideUv = tile.quads[0];
  if (sideUv) {
    for (const edge of openEdges) {
      geometries.push(
        buildSideFaceQuad(sideUv, edge, worldX, worldZ, tileWorldSize, baseY, wallPrismHeight),
      );
    }
  }

  if (tile.quads.length === 4) {
    const half = tileWorldSize / 2;
    for (let i = 0; i < 4; i++) {
      const uv = tile.quads[i];
      if (!uv) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cap = buildGroundQuad(uv, worldX + col * half, worldZ + row * half, half, half);
      cap.translate(0, capY, 0);
      geometries.push(cap);
    }
  } else {
    const uv = tile.quads[0];
    if (uv) {
      const cap = buildGroundQuad(uv, worldX, worldZ, tileWorldSize, tileWorldSize);
      cap.translate(0, capY, 0);
      geometries.push(cap);
    }
  }

  return geometries;
}

/**
 * Builds one tile's quad geometry/geometries, positioned in world space.
 *
 * - Star-bit "upper layer" tiles (`tile.elevation === 'upper'`) render as a
 *   single-sided vertical quad (or 4 quarter-quads for an autotile), but
 *   anchored at `tile.starStack`'s base tile/level (MV3D's "tileoffset"
 *   convention -- see `StarStackData`'s doc comment), not the tile's own
 *   cell: a star tile at `(x, y)` stands on the tile south of it, stacked
 *   above any other star tiles already sitting on that same base.
 * - A3/A4 wall-autotile tiles become 3D prisms (`buildWallPrismGeometry`).
 * - Everything else is a flat ground quad at `y = tile.height * heightUnit`,
 *   plus any cliff side faces the tile's elevation needs.
 *
 * A plain tile (`tile.quads.length === 1`) yields one full-size quad. An
 * autotile (`tile.quads.length === 4`) yields 4 quarter-size quads, one per
 * quadrant of the tile's footprint, in the same destination order `tile-uv.ts`
 * documents: [top-left, top-right, bottom-left, bottom-right], where "top" is
 * the map-north/image-top edge (smaller tileY) and "left" is the map-west
 * edge (smaller tileX). For an upper-layer wall, "top" instead maps to the
 * upper half of the standing quad (nearer wallHeight), matching how the
 * single-quad case already maps image-top to the plane's local +Y (see
 * `applyQuadUv`: vertex 0/1's v1 uses the source rect's top edge, and those
 * are the PlaneGeometry vertices at local +height/2, which point toward
 * wallHeight after the translate below).
 */
function buildTileGeometry(
  tile: TileBuildData,
  tileWorldSize: number,
  wallHeight: number,
  heightUnit: number,
  wallPrismHeight: number,
  wallOpenEdges: readonly EdgeDirection[],
): THREE.BufferGeometry[] {
  const worldX = tile.tileX * tileWorldSize;
  const worldZ = tile.tileY * tileWorldSize;
  const elevationLift = (tile.height ?? 0) * heightUnit;
  // z-fight fix: separates ground quads from different editable layers at
  // the same cell (see LAYER_LIFT_FACTOR's doc comment). Not applied to
  // 'upper'/wall-prism geometry below -- star tiles and A3/A4 prisms are
  // already extruded well clear of the ground plane, and ramps/cliffs are
  // only ever generated for a cell's layer-0 tile (chunk-geometry.ts's
  // "layer-0 ownership rule"), so `layerLift` is always 0 there in practice.
  const layerLift = tile.layerIndex * LAYER_LIFT_FACTOR * tileWorldSize;

  if (tile.elevation === 'upper') {
    // Anchor at the star tile's stack base (MV3D "tileoffset" convention --
    // see `StarStackData`'s doc comment) when `chunk-geometry.ts` computed
    // one; otherwise (hand-built `TileBuildData` fixtures with no
    // `starStack`) fall back to the tile's own cell, matching this
    // function's pre-fix behavior.
    const stack = tile.starStack;
    const standWorldZ = stack ? stack.baseTileY * tileWorldSize : worldZ;
    const standCenterZ = standWorldZ + tileWorldSize / 2;
    const standBaseLift = stack
      ? stack.baseHeight * heightUnit +
        (stack.baseIsWall ? wallPrismHeight : 0) +
        stack.level * wallHeight
      : elevationLift;

    if (tile.quads.length === 4) {
      const half = tileWorldSize / 2;
      const halfWallHeight = wallHeight / 2;
      const geometries: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        const uv = tile.quads[i];
        if (!uv) continue;
        const col = i % 2; // 0 = west/left, 1 = east/right
        const row = Math.floor(i / 2); // 0 = north/image-top, 1 = south/image-bottom
        const baseY = (row === 0 ? halfWallHeight : 0) + standBaseLift;
        geometries.push(
          buildWallQuad(uv, worldX + col * half, baseY, standCenterZ, half, halfWallHeight),
        );
      }
      return geometries;
    }

    const uv = tile.quads[0];
    if (!uv) return [];
    return [buildWallQuad(uv, worldX, standBaseLift, standCenterZ, tileWorldSize, wallHeight)];
  }

  if (isWallSheet(tile.sheet)) {
    return buildWallPrismGeometry(tile, tileWorldSize, wallPrismHeight, heightUnit, wallOpenEdges);
  }

  const ramp = tile.ramp;
  const geometries: THREE.BufferGeometry[] = [];
  if (tile.quads.length === 4) {
    const half = tileWorldSize / 2;
    for (let i = 0; i < 4; i++) {
      const uv = tile.quads[i];
      if (!uv) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const quad = buildGroundQuad(uv, worldX + col * half, worldZ + row * half, half, half);
      if (ramp) {
        applyRampSlope(quad, ramp, worldX, worldZ, tileWorldSize, heightUnit);
        if (layerLift !== 0) quad.translate(0, layerLift, 0);
      } else if (elevationLift !== 0 || layerLift !== 0) {
        quad.translate(0, elevationLift + layerLift, 0);
      }
      geometries.push(quad);
    }
  } else {
    const uv = tile.quads[0];
    if (uv) {
      const quad = buildGroundQuad(uv, worldX, worldZ, tileWorldSize, tileWorldSize);
      if (ramp) {
        applyRampSlope(quad, ramp, worldX, worldZ, tileWorldSize, heightUnit);
        if (layerLift !== 0) quad.translate(0, layerLift, 0);
      } else if (elevationLift !== 0 || layerLift !== 0) {
        quad.translate(0, elevationLift + layerLift, 0);
      }
      geometries.push(quad);
    }
  }
  geometries.push(...buildCliffGeometry(tile, tileWorldSize, heightUnit));
  geometries.push(...buildRampSkirts(tile, tileWorldSize, heightUnit));
  return geometries;
}

/**
 * Builds one `THREE.Group` for a chunk, containing one `Mesh` per sheet used
 * by that chunk's tiles. Each mesh's geometry is a single merged
 * `BufferGeometry` (ground and upper-layer quads combined) so a chunk costs
 * at most one draw call per sheet, not one per tile.
 *
 * A sheet with no entry in `materials` (not loaded, or genuinely unused) is
 * skipped rather than throwing -- callers only need to provide materials for
 * the sheets they actually loaded.
 */
export function buildChunkGroup(
  chunk: ChunkBuildData,
  materials: Partial<Record<TileSheetId, THREE.Material>>,
  options: BuildChunkGroupOptions = {},
): THREE.Group {
  const tileWorldSize = options.tileWorldSize ?? 1;
  const wallHeight = options.wallHeight ?? tileWorldSize;
  const heightUnit = options.heightUnit ?? tileWorldSize;
  const wallPrismHeight = options.wallPrismHeight ?? 2 * tileWorldSize;

  // Wall-tile adjacency for interior-face culling: whole-map when the caller
  // provides it (see `BuildChunkGroupOptions.wallTileKeys`), else falls back
  // to this chunk's own tiles only.
  const wallTileKeys = options.wallTileKeys ?? computeWallTileKeys(chunk.tiles);

  const ceilingCarve = options.ceilingCarve;
  const geometriesBySheet = new Map<TileSheetId, THREE.BufferGeometry[]>();
  const carveBuckets = new Map<string, CarveBucket>();
  for (const tile of chunk.tiles) {
    const isWallTile = tile.elevation !== 'upper' && isWallSheet(tile.sheet);
    const openEdges = isWallTile ? computeOpenEdges(wallTileKeys, tile.tileX, tile.tileY) : [];

    const geometries = buildTileGeometry(
      tile,
      tileWorldSize,
      wallHeight,
      heightUnit,
      wallPrismHeight,
      openEdges,
    );

    // Carve-eligible: flat ground-quad tiles only (plus their cliff/skirt
    // faces) -- never star-bit "upper layer" quads or wall-autotile (A3/A4)
    // prisms, regardless of what room id their cell carries.
    const carveEligible = !isWallTile && tile.elevation !== 'upper';
    const roomId =
      carveEligible && ceilingCarve
        ? (ceilingCarve.roomIdGrid[tile.tileY * ceilingCarve.mapWidth + tile.tileX] ?? 0)
        : 0;

    if (roomId !== 0) {
      const key = `${tile.sheet}|${roomId}`;
      let bucket = carveBuckets.get(key);
      if (!bucket) {
        bucket = { sheet: tile.sheet, roomId, geometries: [] };
        carveBuckets.set(key, bucket);
      }
      bucket.geometries.push(...geometries);
    } else {
      const sheetGeometries = geometriesBySheet.get(tile.sheet) ?? [];
      sheetGeometries.push(...geometries);
      geometriesBySheet.set(tile.sheet, sheetGeometries);
    }
  }

  const group = new THREE.Group();
  group.name = `chunk-${chunk.chunkX}-${chunk.chunkY}`;

  for (const [sheet, geometries] of geometriesBySheet) {
    const material = materials[sheet];
    if (!material) {
      for (const geometry of geometries) geometry.dispose();
      continue;
    }

    const merged = mergeGeometries(geometries, false) as THREE.BufferGeometry | null;
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `chunk-${chunk.chunkX}-${chunk.chunkY}-${sheet}`;
    group.add(mesh);
  }

  // Ceiling-carve buckets: same material as the sheet's normal mesh (Slice
  // 3a is geometry-only -- per-room material cloning is Slice 3b).
  for (const bucket of carveBuckets.values()) {
    const material = materials[bucket.sheet];
    if (!material) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }

    const merged = mergeGeometries(bucket.geometries, false) as THREE.BufferGeometry | null;
    for (const geometry of bucket.geometries) geometry.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `chunk-${chunk.chunkX}-${chunk.chunkY}-${bucket.sheet}-room-${bucket.roomId}`;
    group.add(mesh);
  }

  const shadows = chunk.shadows ?? [];
  if (options.shadowMaterial && shadows.length > 0) {
    const shadowGeometries = shadows.flatMap((shadow) =>
      buildShadowGeometry(shadow, tileWorldSize, heightUnit),
    );
    const merged = mergeGeometries(shadowGeometries, false) as THREE.BufferGeometry | null;
    for (const geometry of shadowGeometries) geometry.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, options.shadowMaterial);
      mesh.name = `chunk-${chunk.chunkX}-${chunk.chunkY}-shadow`;
      group.add(mesh);
    }
  }

  return group;
}
