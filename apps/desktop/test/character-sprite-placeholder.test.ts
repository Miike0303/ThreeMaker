/**
 * `buildPlaceholderCharacterTexture` (loop-crear-jugar Slice 4b): an
 * in-memory, production-safe substitute for the DEV-only Roseliam fixture
 * character sheet (`fixtureCharacterUrl`), sized and laid out exactly like
 * `CharacterSprite`'s real expected sheet (`DEFAULT_SHEET_COLUMNS` x
 * `DEFAULT_SHEET_ROWS` blocks, each block `FRAME_COLUMNS` walk-frames x
 * `FRAME_ROWS` facing directions) so `main.ts`'s single shared
 * `CharacterSprite` construction (used by both the DEV and authored paths)
 * can render a player sprite without ever depending on the fixture.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_COLUMNS,
  DEFAULT_SHEET_ROWS,
  DIRECTION_ROW,
  FRAME_COLUMNS,
  FRAME_ROWS,
} from '../src/character-sprite.js';
import {
  buildPlaceholderCharacterTexture,
  FRAME_PIXEL_SIZE,
} from '../src/character-sprite-placeholder.js';

describe('buildPlaceholderCharacterTexture', () => {
  it('produces a real THREE texture sized to the full sheet grid the renderer expects', () => {
    const texture = buildPlaceholderCharacterTexture();

    expect(texture).toBeInstanceOf(THREE.Texture);
    const totalCols = DEFAULT_SHEET_COLUMNS * FRAME_COLUMNS;
    const totalRows = DEFAULT_SHEET_ROWS * FRAME_ROWS;
    const image = texture.image as { width: number; height: number; data: Uint8Array };
    expect(image.width).toBe(totalCols * FRAME_PIXEL_SIZE);
    expect(image.height).toBe(totalRows * FRAME_PIXEL_SIZE);
  });

  it('is upload-ready: version bumped by needsUpdate, and flipY matches a normally-loaded image (row 0 = top)', () => {
    const texture = buildPlaceholderCharacterTexture();

    // `needsUpdate` is a write-only setter on `THREE.Texture` (no matching
    // getter) that bumps `version` as its only observable side effect --
    // asserting `version > 0` is the only way to confirm it was set.
    expect(texture.version).toBeGreaterThan(0);
    expect(texture.flipY).toBe(true);
  });

  it('paints each facing row of block 0 (the only block main.ts ever selects) with a distinct opaque color', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };

    const colorAt = (col: number, row: number): [number, number, number, number] => {
      const x = col * FRAME_PIXEL_SIZE;
      const y = row * FRAME_PIXEL_SIZE;
      const i = (y * image.width + x) * 4;
      return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
    };

    const directions = Object.keys(DIRECTION_ROW) as (keyof typeof DIRECTION_ROW)[];
    const colorsByDirection = new Map<string, string>();
    for (const direction of directions) {
      const row = DIRECTION_ROW[direction];
      const [r, g, b, a] = colorAt(0, row);
      expect(a).toBe(255);
      colorsByDirection.set(direction, `${r},${g},${b}`);

      // All FRAME_COLUMNS walk-frame columns of this facing row share the
      // same color -- the placeholder does not animate.
      for (let col = 1; col < FRAME_COLUMNS; col++) {
        expect(colorAt(col, row)).toEqual(colorAt(0, row));
      }
    }
    // Every direction's color must be visually distinct from the others.
    expect(new Set(colorsByDirection.values()).size).toBe(directions.length);
  });

  it('fills every unused block (characterIndex !== 0) with a neutral, non-transparent filler', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };

    // Block (1, 0): the second column-block, first row-block -- never
    // selected by main.ts's characterIndex: 0, but must still be a valid,
    // opaque pixel (not zeroed/transparent).
    const col = FRAME_COLUMNS; // first column of block (1, 0)
    const row = 0;
    const x = col * FRAME_PIXEL_SIZE;
    const y = row * FRAME_PIXEL_SIZE;
    const i = (y * image.width + x) * 4;
    expect(image.data[i + 3]).toBe(255);
  });

  it('keeps the left-facing placeholder frame blue', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };
    const pixel = DIRECTION_ROW.left * FRAME_PIXEL_SIZE * image.width * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([0, 110, 220, 255]);
    texture.dispose();
  });

  it('keeps the right-facing placeholder frame orange', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };
    const pixel = DIRECTION_ROW.right * FRAME_PIXEL_SIZE * image.width * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([230, 140, 0, 255]);
    texture.dispose();
  });

  it('keeps the down-facing placeholder frame green', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { data: Uint8Array };

    expect(Array.from(image.data.slice(0, 4))).toEqual([0, 170, 0, 255]);
  });

  it('fills the full width of a facing frame without transparent stripes', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };
    const x = FRAME_PIXEL_SIZE - 1;
    const pixel = x * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([0, 170, 0, 255]);
  });

  it('paints the up-facing row at the end of the first character block', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };
    const pixel = DIRECTION_ROW.up * FRAME_PIXEL_SIZE * image.width * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([220, 210, 0, 255]);
  });

  it('keeps the first frame of the next character block neutral gray', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { data: Uint8Array };
    const pixel = FRAME_COLUMNS * FRAME_PIXEL_SIZE * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([128, 128, 128, 255]);
  });

  it('fills the bottom edge of the down-facing placeholder frame', () => {
    const texture = buildPlaceholderCharacterTexture();
    const image = texture.image as { width: number; data: Uint8Array };
    const pixel = (FRAME_PIXEL_SIZE - 1) * image.width * 4;

    expect(Array.from(image.data.slice(pixel, pixel + 4))).toEqual([0, 170, 0, 255]);
  });
});
