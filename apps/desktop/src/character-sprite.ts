import type { Direction } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import type { WalkFrameColumn } from './walk-animation.js';

// RPG Maker MV/MZ standard character-sheet row order: down, left, right, up.
// Exported so `character-sprite-placeholder.ts` can paint one distinct color
// per facing row without duplicating (and risking desync with) this mapping.
export const DIRECTION_ROW: Record<Direction, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

// Exported for the same reason as `DIRECTION_ROW`: the placeholder sprite
// generator needs the exact frame grid this class assumes, not a duplicated
// guess at it.
export const FRAME_COLUMNS = 3; // walk frames per character block
export const FRAME_ROWS = 4; // facing directions per character block

/** Character blocks across a standard 8-character MV/MZ sheet -- `CharacterSpriteOptions.sheetColumns`'s default, and the single source of truth `main.ts` and the placeholder sprite generator both build against. */
export const DEFAULT_SHEET_COLUMNS = 4;
/** Character blocks down a standard 8-character MV/MZ sheet -- `CharacterSpriteOptions.sheetRows`'s default, see `DEFAULT_SHEET_COLUMNS`. */
export const DEFAULT_SHEET_ROWS = 2;

/** World-space center of a tile coordinate. The single source of the tile-origin convention: change it here and every consumer (sprite, camera) stays in lockstep. */
export function tileCenterToWorld(tileCoord: number, tileWorldSize = 1): number {
  return (tileCoord + 0.5) * tileWorldSize;
}

export interface CharacterSpriteOptions {
  /** The character sheet texture (already pixel-art configured: NearestFilter, no mipmaps). */
  readonly texture: THREE.Texture;
  /** Character blocks across the sheet horizontally. Defaults to 4 (a standard 8-character MV/MZ sheet); use 1 for a `$`-prefixed single-character sheet. */
  readonly sheetColumns?: number;
  /** Character blocks down the sheet vertically. Defaults to 2; use 1 for a `$`-prefixed single-character sheet. */
  readonly sheetRows?: number;
  /** Which of the `sheetColumns * sheetRows` character blocks to render (row-major, 0-based). Defaults to 0 (top-left). */
  readonly characterIndex?: number;
  /** World-space width/depth of one tile; must match the tilemap's own `tileWorldSize`. Defaults to 1. */
  readonly tileWorldSize?: number;
  /** World-space height of the character quad, in tile units. Defaults to 1. */
  readonly heightTiles?: number;
  /** How far (world units) the quad is nudged toward the camera each frame, to avoid z-fighting with coplanar ground/wall geometry. Defaults to 0.02. */
  readonly cameraBias?: number;
}

/**
 * A single camera-facing billboard quad for one RPG Maker character-sheet
 * block: a `PlaneGeometry` with per-frame UVs into the sheet, standing
 * upright with its base on the ground (like the renderer's extruded
 * upper-layer wall tiles) instead of lying flat. One character = one draw
 * call.
 *
 * ponytail: this renders exactly one character. A crowd of NPCs would want
 * instanced TSL billboards (per the engine's own sprite plan) instead of one
 * mesh each -- out of scope for this single-player-character slice.
 */
export class CharacterSprite {
  readonly mesh: THREE.Mesh;

  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly uvAttribute: THREE.BufferAttribute;
  private readonly sheetColumns: number;
  private readonly sheetRows: number;
  private readonly blockCol: number;
  private readonly blockRow: number;
  private readonly cameraBias: number;
  private readonly toCamera = new THREE.Vector3();
  private readonly basePosition = new THREE.Vector3();

  private lastDirection: Direction | null = null;
  private lastFrame: WalkFrameColumn | null = null;
  private disposed = false;

  constructor(options: CharacterSpriteOptions) {
    const {
      texture,
      sheetColumns = DEFAULT_SHEET_COLUMNS,
      sheetRows = DEFAULT_SHEET_ROWS,
      characterIndex = 0,
      tileWorldSize = 1,
      heightTiles = 1,
      cameraBias = 0.02,
    } = options;

    this.sheetColumns = sheetColumns;
    this.sheetRows = sheetRows;
    this.blockCol = characterIndex % sheetColumns;
    this.blockRow = Math.floor(characterIndex / sheetColumns);
    this.cameraBias = cameraBias;

    const worldHeight = heightTiles * tileWorldSize;
    this.geometry = new THREE.PlaneGeometry(tileWorldSize, worldHeight);
    // Lift the quad so its base (feet), not its center, sits at y=0 -- the
    // same convention `build-chunk-group.ts` uses for extruded wall quads.
    this.geometry.translate(0, worldHeight / 2, 0);
    this.uvAttribute = this.geometry.getAttribute('uv') as THREE.BufferAttribute;

    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'player-character';

    this.setFrame('down', 1);
  }

  /**
   * Places the quad at a (possibly fractional, mid-step) tile position.
   * `tileWorldSize` must match the value the tilemap was built with.
   * `groundY` is the world-space elevation of the tile the character stands
   * on (region-derived height * heightUnit, see `elevation.ts`); defaults to
   * 0 (flat ground). Cross-height steps are blocked by `PassabilityGrid`, so
   * a single step's source and destination are always the same elevation --
   * no interpolation between two different `groundY` values is needed here.
   */
  setTilePosition(tileX: number, tileY: number, tileWorldSize = 1, groundY = 0): void {
    this.basePosition.set(
      tileCenterToWorld(tileX, tileWorldSize),
      groundY,
      tileCenterToWorld(tileY, tileWorldSize),
    );
    this.mesh.position.copy(this.basePosition);
  }

  /** Updates the visible frame to `direction`'s row and `frameColumn`'s column; a no-op (no GPU upload) when neither changed since the last call. */
  setFrame(direction: Direction, frameColumn: WalkFrameColumn): void {
    if (direction === this.lastDirection && frameColumn === this.lastFrame) return;
    this.lastDirection = direction;
    this.lastFrame = frameColumn;

    const totalCols = this.sheetColumns * FRAME_COLUMNS;
    const totalRows = this.sheetRows * FRAME_ROWS;
    const col = this.blockCol * FRAME_COLUMNS + frameColumn;
    const rowFromTop = this.blockRow * FRAME_ROWS + DIRECTION_ROW[direction];

    const u0 = col / totalCols;
    const u1 = (col + 1) / totalCols;
    // Image space grows downward; three.js UV space grows upward -- flip once here.
    const v1 = 1 - rowFromTop / totalRows;
    const v0 = 1 - (rowFromTop + 1) / totalRows;

    // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right.
    this.uvAttribute.setXY(0, u0, v1);
    this.uvAttribute.setXY(1, u1, v1);
    this.uvAttribute.setXY(2, u0, v0);
    this.uvAttribute.setXY(3, u1, v0);
    this.uvAttribute.needsUpdate = true;
  }

  /**
   * Rotates the quad around Y to face `camera` (staying upright, not a full
   * spherical billboard) and nudges it slightly toward the camera along
   * that same direction, so it doesn't z-fight with ground/wall geometry at
   * the same depth. Call after `setTilePosition` each frame.
   *
   * Idempotent by construction: the bias is re-derived from `basePosition`
   * (the last `setTilePosition` call) every time, never from the previously
   * nudged `mesh.position`. Calling this N times without an intervening
   * `setTilePosition` leaves the mesh at the same place as calling it once --
   * this used to mutate `mesh.position` cumulatively, which drifted sprites
   * that call `faceCamera` every frame but `setTilePosition` only once (NPCs)
   * toward the camera indefinitely.
   */
  faceCamera(camera: THREE.Camera): void {
    this.toCamera.copy(camera.position).sub(this.basePosition);
    this.toCamera.y = 0;
    if (this.toCamera.lengthSq() === 0) return;

    this.mesh.rotation.y = Math.atan2(this.toCamera.x, this.toCamera.z);
    this.toCamera.normalize().multiplyScalar(this.cameraBias);
    this.mesh.position.copy(this.basePosition).add(this.toCamera);
  }

  /** Frees the quad's own geometry/material. Does not dispose the shared `texture` passed in -- the caller owns that. */
  dispose(): void {
    if (this.disposed) return;
    this.geometry.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}
