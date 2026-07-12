/**
 * Production-safe placeholder player-sprite texture (loop-crear-jugar Slice
 * 4b): the authored-load path (`main.ts`) needs SOME character texture to
 * hand `CharacterSprite`, but has no `object` reference for the player
 * sprite yet (spawn/character authoring is out of this change's scope) and
 * must not depend on the DEV-only Roseliam fixture (`fixtureCharacterUrl`,
 * served only via Vite's `/@fs/` dev endpoint -- absent from a production
 * build). Built entirely in-memory (`THREE.DataTexture`, no fs/network),
 * the same convention `authored-map.ts`'s `buildPlaceholderTexture` already
 * established for a missing tileset object.
 *
 * Sized to match `CharacterSprite`'s actual expected frame layout exactly --
 * `DEFAULT_SHEET_COLUMNS` blocks x `DEFAULT_SHEET_ROWS` blocks, each block
 * `FRAME_COLUMNS` walk-frames x `FRAME_ROWS` facing directions. `main.ts`
 * always constructs `CharacterSprite` with those same sheet defaults for
 * BOTH the DEV-fixture and authored paths (`renderFixtureMap` is shared), so
 * this placeholder must be pixel-grid-compatible with that shared
 * instantiation, not just "a" plausibly-sized image.
 *
 * Only block 0 (`characterIndex: 0`, the only block `main.ts` ever selects)
 * gets meaningful content: each of its `FRAME_ROWS` facing rows is filled
 * with one distinct, opaque, flat color -- all `FRAME_COLUMNS` walk-frame
 * columns of a row share that same color, since the placeholder does not
 * animate. This lets a developer visually confirm facing/direction wiring
 * without a bundled asset. The other unused blocks are filled with a
 * neutral gray filler so the sheet stays structurally valid even if
 * `characterIndex` ever changes.
 */

import type { Direction } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import {
  DEFAULT_SHEET_COLUMNS,
  DEFAULT_SHEET_ROWS,
  DIRECTION_ROW,
  FRAME_COLUMNS,
  FRAME_ROWS,
} from './character-sprite.js';

/** Pixel size (both axes) of one walk-frame cell in the generated sheet. Arbitrary -- large enough to be visibly a solid color, small enough the whole in-memory buffer stays trivial. */
export const FRAME_PIXEL_SIZE = 8;

type Rgba = readonly [number, number, number, number];

/** Neutral, opaque gray filler for every sheet block `main.ts` never selects (`characterIndex` is always 0). */
const FILLER_RGBA: Rgba = [128, 128, 128, 255];

/** One flat, opaque, visually-distinct color per facing direction. */
const DIRECTION_COLOR: Record<Direction, Rgba> = {
  down: [0, 170, 0, 255],
  left: [0, 110, 220, 255],
  right: [230, 140, 0, 255],
  up: [220, 210, 0, 255],
};

// Row (within block 0) -> color, derived from the single-source-of-truth
// `DIRECTION_ROW` mapping so this can never silently desync from it.
const ROW_COLOR: Rgba[] = [];
for (const [direction, row] of Object.entries(DIRECTION_ROW) as [Direction, number][]) {
  ROW_COLOR[row] = DIRECTION_COLOR[direction];
}

function paintCell(data: Uint8Array, widthPx: number, col: number, row: number, rgba: Rgba): void {
  const startX = col * FRAME_PIXEL_SIZE;
  const startY = row * FRAME_PIXEL_SIZE;
  for (let y = 0; y < FRAME_PIXEL_SIZE; y++) {
    for (let x = 0; x < FRAME_PIXEL_SIZE; x++) {
      const i = ((startY + y) * widthPx + (startX + x)) * 4;
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
    }
  }
}

/**
 * Builds the placeholder player-sprite sheet texture described above.
 * Synchronous and side-effect-free besides the returned `THREE.Texture` --
 * no fs, no network, no DOM canvas (this repo's `vitest` config runs with
 * `environment: 'node'`, so a real `<canvas>`/`OffscreenCanvas` isn't
 * available there; a raw pixel buffer via `THREE.DataTexture` is both
 * simpler and directly unit-testable, and works identically at runtime).
 */
export function buildPlaceholderCharacterTexture(): THREE.Texture {
  const totalCols = DEFAULT_SHEET_COLUMNS * FRAME_COLUMNS;
  const totalRows = DEFAULT_SHEET_ROWS * FRAME_ROWS;
  const widthPx = totalCols * FRAME_PIXEL_SIZE;
  const heightPx = totalRows * FRAME_PIXEL_SIZE;
  const data = new Uint8Array(widthPx * heightPx * 4);

  for (let row = 0; row < totalRows; row++) {
    const isBlockZeroRow = row < FRAME_ROWS;
    for (let col = 0; col < totalCols; col++) {
      const isBlockZeroCol = col < FRAME_COLUMNS;
      const rgba = isBlockZeroRow && isBlockZeroCol ? (ROW_COLOR[row] ?? FILLER_RGBA) : FILLER_RGBA;
      paintCell(data, widthPx, col, row, rgba);
    }
  }

  const texture = new THREE.DataTexture(data, widthPx, heightPx);
  // `CharacterSprite.setFrame`'s V-flip math assumes the same row convention
  // as a normally loaded image (row 0 = top of the sheet, matching
  // `DIRECTION_ROW.down === 0`) -- `THREE.DataTexture` defaults `flipY` to
  // `false` (raw-buffer convention: row 0 = bottom), the opposite of what a
  // `TextureLoader`-produced texture gets by default (`flipY: true`). Set
  // explicitly so this placeholder behaves identically to a real loaded
  // character sheet.
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}
