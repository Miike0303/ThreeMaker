/**
 * Starter placeholder A5/B sheets + composePlaceholderMap (catalog-free paint path).
 */
import { getTileSheet } from '@threemaker/importer-rpgm';
import { primaryFloorLayers } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { composePlaceholderMap, toRenderableMap } from '../src/map-compose.js';
import {
  buildPlaceholderTextures,
  encodeRgbaPng,
  PLACEHOLDER_A5_COLS,
  PLACEHOLDER_A5_ROWS,
  PLACEHOLDER_B_COLS,
  PLACEHOLDER_B_ROWS,
  PLACEHOLDER_DECOR_TILE_ID,
  PLACEHOLDER_GROUND_TILE_ID,
  PLACEHOLDER_TILE_PIXEL_SIZE,
  placeholderSheetPngBytes,
  revokePlaceholderPaletteUrls,
  stampPlaceholderSlotObjects,
} from '../src/placeholder-tileset.js';

describe('buildPlaceholderTextures', () => {
  it('builds A5/B sheets at the standard RPGM plain-grid sizes @ 48px', () => {
    const built = buildPlaceholderTextures();
    try {
      expect(built.sheetPixelSizes.A5).toEqual({
        width: PLACEHOLDER_A5_COLS * PLACEHOLDER_TILE_PIXEL_SIZE,
        height: PLACEHOLDER_A5_ROWS * PLACEHOLDER_TILE_PIXEL_SIZE,
      });
      expect(built.sheetPixelSizes.B).toEqual({
        width: PLACEHOLDER_B_COLS * PLACEHOLDER_TILE_PIXEL_SIZE,
        height: PLACEHOLDER_B_ROWS * PLACEHOLDER_TILE_PIXEL_SIZE,
      });
      expect(built.sheetPixelSizes.A5).toEqual({ width: 384, height: 768 });
      expect(built.sheetPixelSizes.B).toEqual({ width: 768, height: 768 });

      const a5Image = built.textures.A5?.image as {
        width: number;
        height: number;
        data: Uint8Array;
      };
      const bImage = built.textures.B?.image as { width: number; height: number; data: Uint8Array };
      expect(a5Image.width).toBe(384);
      expect(a5Image.height).toBe(768);
      expect(bImage.width).toBe(768);
      expect(bImage.height).toBe(768);
      expect(built.textures.A5?.flipY).toBe(true);
      expect(built.textures.B?.flipY).toBe(true);
    } finally {
      revokePlaceholderPaletteUrls(built.paletteUrls);
    }
  });

  it('paints opaque pixels and differs adjacent cells (checkerboard)', () => {
    const built = buildPlaceholderTextures();
    try {
      const image = built.textures.A5?.image as { width: number; data: Uint8Array };
      const tile = PLACEHOLDER_TILE_PIXEL_SIZE;
      const sample = (col: number, row: number): [number, number, number, number] => {
        const x = col * tile;
        const y = row * tile;
        const i = (y * image.width + x) * 4;
        return [
          image.data[i] ?? 0,
          image.data[i + 1] ?? 0,
          image.data[i + 2] ?? 0,
          image.data[i + 3] ?? 0,
        ];
      };
      const a = sample(0, 0);
      const b = sample(1, 0);
      expect(a[3]).toBe(255);
      expect(b[3]).toBe(255);
      expect(`${a[0]},${a[1]},${a[2]}`).not.toBe(`${b[0]},${b[1]},${b[2]}`);
      // Every pixel opaque.
      for (let i = 3; i < image.data.length; i += 4) {
        expect(image.data[i]).toBe(255);
      }
    } finally {
      revokePlaceholderPaletteUrls(built.paletteUrls);
    }
  });

  it('encodes a PNG blob URL with the PNG signature for the palette', () => {
    const built = buildPlaceholderTextures();
    try {
      expect(built.paletteUrls.A5.startsWith('blob:')).toBe(true);
      expect(built.paletteUrls.B.startsWith('blob:')).toBe(true);
      const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
      const png = encodeRgbaPng(2, 1, rgba);
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      revokePlaceholderPaletteUrls(built.paletteUrls);
    }
  });
});

describe('composePlaceholderMap', () => {
  it('seeds ground with PLACEHOLDER_GROUND_TILE_ID on A5 and keeps flags passable', () => {
    const doc = composePlaceholderMap({
      id: 'starter-1',
      name: 'Starter',
      width: 4,
      height: 3,
    });

    expect(PLACEHOLDER_GROUND_TILE_ID).toBe(1536);
    expect(PLACEHOLDER_DECOR_TILE_ID).toBe(1);
    expect(getTileSheet(PLACEHOLDER_GROUND_TILE_ID)).toBe('A5');
    expect(getTileSheet(PLACEHOLDER_DECOR_TILE_ID)).toBe('B');

    const ground = primaryFloorLayers(doc).tiles[0];
    expect(ground).toBeDefined();
    expect(ground?.every((id) => id === PLACEHOLDER_GROUND_TILE_ID)).toBe(true);
    expect(doc.tileset.flags).toHaveLength(8192);
    expect(doc.tileset.flags.every((f) => f === 0)).toBe(true);
    // Compose stays pure: empty slots until the create site stamps shas.
    expect(doc.tileset.slots.A5).toEqual({});
    expect(doc.tileset.slots.B).toEqual({});
    expect(doc.tileset.slots.A5?.object).toBeUndefined();
    expect(doc.tileset.slots.B?.object).toBeUndefined();
  });

  it('stampPlaceholderSlotObjects sets A5/B.object to 64-hex shas', () => {
    const doc = composePlaceholderMap({
      id: 'starter-stamp',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    const a5 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const stamped = stampPlaceholderSlotObjects(doc, { A5: a5, B: b });
    expect(stamped.tileset.slots.A5?.object).toBe(a5);
    expect(stamped.tileset.slots.B?.object).toBe(b);
    expect(doc.tileset.slots.A5?.object).toBeUndefined();
  });

  it('placeholderSheetPngBytes emits a PNG signature for A5 and B', () => {
    for (const slot of ['A5', 'B'] as const) {
      const png = placeholderSheetPngBytes(slot);
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });

  it('toRenderableMap does not throw on a placeholder document', () => {
    const doc = composePlaceholderMap({
      id: 'starter-2',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    expect(() => toRenderableMap(doc)).not.toThrow();
    const map = toRenderableMap(doc);
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.layers.tileLayers[0]?.[0]).toBe(PLACEHOLDER_GROUND_TILE_ID);
  });
});
