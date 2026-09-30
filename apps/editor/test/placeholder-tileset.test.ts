/**
 * Starter placeholder A5/B sheets + composePlaceholderMap (catalog-free paint path).
 */
import { crc32, inflateSync } from 'node:zlib';
import { getTileSheet } from '@threemaker/importer-rpgm';
import { describe, expect, it, vi } from 'vitest';
import { composePlaceholderMap, toRenderableMap } from '../src/map-compose.js';
import {
  buildPlaceholderSheetRgba,
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
  textureSheetToObjectUrl,
} from '../src/placeholder-tileset.js';

describe('buildPlaceholderTextures', () => {
  it('labels palette object URLs as PNG images', async () => {
    const texture = {
      image: { width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) },
    } as unknown as Parameters<typeof textureSheetToObjectUrl>[0];
    const url = textureSheetToObjectUrl(texture);
    try {
      const response = await fetch(url);
      expect(response.headers.get('content-type')).toBe('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it('preserves distinct source pixels on successive PNG scanlines', () => {
    const rgba = new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255]);
    const png = encodeRgbaPng(1, 2, rgba);
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    expect([...inflateSync(png.subarray(41, 41 + idatLength))]).toEqual([
      0, 10, 20, 30, 128, 0, 40, 50, 60, 255,
    ]);
  });

  it('ignores trailing RGBA pixels beyond the requested PNG dimensions', () => {
    const rgba = new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255]);
    const png = encodeRgbaPng(1, 1, rgba);
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    expect([...inflateSync(png.subarray(41, 41 + idatLength))]).toEqual([0, 10, 20, 30, 128]);
  });

  it('writes valid checksums for every palette PNG chunk', () => {
    const png = encodeRgbaPng(1, 1, new Uint8Array([10, 20, 30, 128]));
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const chunkTypes: string[] = [];
    for (let offset = 8; offset < png.length; ) {
      const length = view.getUint32(offset);
      const body = png.subarray(offset + 4, offset + 8 + length);
      chunkTypes.push(new TextDecoder().decode(body.subarray(0, 4)));
      expect(view.getUint32(offset + 8 + length)).toBe(crc32(body));
      offset += length + 12;
    }
    expect(chunkTypes).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares eight-bit RGBA pixels in the palette PNG header', () => {
    const png = encodeRgbaPng(1, 1, new Uint8Array([10, 20, 30, 128]));
    expect(Array.from(png.subarray(24, 29))).toEqual([8, 6, 0, 0, 0]);
  });

  it('records independent width and height for a rectangular palette PNG', () => {
    const png = encodeRgbaPng(2, 3, new Uint8Array(2 * 3 * 4).fill(255));
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([header.getUint32(16), header.getUint32(20)]).toEqual([2, 3]);
  });

  it('rejects a zero-width palette image before encoding', () => {
    expect(() => encodeRgbaPng(0, 1, new Uint8Array(0))).toThrow('encodeRgbaPng: invalid size 0x1');
  });

  it('rejects a zero-height palette image before encoding', () => {
    expect(() => encodeRgbaPng(1, 0, new Uint8Array(0))).toThrow('encodeRgbaPng: invalid size 1x0');
  });

  it('rejects a texture whose image has no width before creating a palette URL', () => {
    const texture = { image: { data: new Uint8Array(4), height: 1 } } as unknown as Parameters<
      typeof textureSheetToObjectUrl
    >[0];
    expect(() => textureSheetToObjectUrl(texture)).toThrow(
      'textureSheetToObjectUrl: expected DataTexture with RGBA image.data',
    );
  });

  it('rejects a texture whose image has no height before creating a palette URL', () => {
    const texture = { image: { data: new Uint8Array(4), width: 1 } } as unknown as Parameters<
      typeof textureSheetToObjectUrl
    >[0];
    expect(() => textureSheetToObjectUrl(texture)).toThrow(
      'textureSheetToObjectUrl: expected DataTexture with RGBA image.data',
    );
  });

  it('rejects a truncated RGBA buffer before encoding a palette image', () => {
    expect(() => encodeRgbaPng(1, 1, new Uint8Array([10, 20, 30]))).toThrow(
      'encodeRgbaPng: rgba buffer shorter than width*height*4',
    );
  });

  it('encodes a palette image that spans multiple stored deflate blocks', () => {
    const rgba = new Uint8Array(128 * 128 * 4).fill(255);
    const png = encodeRgbaPng(128, 128, rgba);
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    const decoded = inflateSync(png.subarray(41, 41 + idatLength));
    const expected = Buffer.alloc(513 * 128, 255);
    for (let row = 0; row < 128; row++) expected[row * 513] = 0;
    expect(decoded).toEqual(expected);
  });

  it('marks the final PNG deflate block so a palette image can be decoded', () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const png = encodeRgbaPng(2, 1, rgba);
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    expect(Array.from(inflateSync(png.subarray(41, 41 + idatLength)))).toEqual([0, ...rgba]);
  });

  it('revokes both starter palette URLs when the map session ends', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      revokePlaceholderPaletteUrls({ A5: 'blob:a5', B: 'blob:b' });
      expect(revoke.mock.calls).toEqual([['blob:a5'], ['blob:b']]);
    } finally {
      revoke.mockRestore();
    }
  });

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
      let firstNonOpaque = -1;
      for (let i = 3; i < image.data.length; i += 4) {
        if (image.data[i] !== 255) {
          firstNonOpaque = i;
          break;
        }
      }
      expect(firstNonOpaque).toBe(-1);
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
  it('preserves authored tileset metadata when stamping starter object hashes', () => {
    const doc = composePlaceholderMap({
      id: 'starter-tileset-metadata',
      name: 'Starter',
      width: 2,
      height: 3,
    });
    const authored = { ...doc, tileset: { ...doc.tileset, tilePixelSize: 96 } };
    const stamped = stampPlaceholderSlotObjects(authored, {
      A5: 'a'.repeat(64),
      B: 'b'.repeat(64),
    });

    expect(stamped.tileset).toMatchObject({
      tilePixelSize: authored.tileset.tilePixelSize,
      flags: authored.tileset.flags,
      semantics: authored.tileset.semantics,
    });
  });

  it('preserves the authored map and floors when stamping starter object hashes', () => {
    const doc = composePlaceholderMap({
      id: 'starter-map-preservation',
      name: 'Harbor',
      width: 2,
      height: 3,
    });
    const stamped = stampPlaceholderSlotObjects(doc, {
      A5: 'a'.repeat(64),
      B: 'b'.repeat(64),
    });

    expect(stamped).toMatchObject({
      id: doc.id,
      name: doc.name,
      version: doc.version,
      width: doc.width,
      height: doc.height,
      floors: doc.floors,
    });
  });

  it('preserves A5 provenance independently when stamping starter object hashes', () => {
    const doc = composePlaceholderMap({
      id: 'starter-a5-provenance',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    const a5 = { object: 'c'.repeat(64), sourceGameId: 10, sourceTilesetId: 20 };
    const authored = {
      ...doc,
      tileset: {
        ...doc.tileset,
        slots: {
          ...doc.tileset.slots,
          A5: a5,
          B: { object: 'd'.repeat(64), sourceGameId: 30, sourceTilesetId: 40 },
        },
      },
    };
    const stamped = stampPlaceholderSlotObjects(authored, {
      A5: 'a'.repeat(64),
      B: 'b'.repeat(64),
    });
    expect(stamped.tileset.slots.A5).toEqual({ ...a5, object: 'a'.repeat(64) });
  });

  it('rejects a starter object hash one digit shorter than SHA-256', () => {
    const doc = composePlaceholderMap({
      id: 'starter-short-sha',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    expect(() =>
      stampPlaceholderSlotObjects(doc, { A5: 'a'.repeat(63), B: 'b'.repeat(64) }),
    ).toThrow('A5/B object shas must be 64 lowercase hex chars');
  });

  it('preserves B slot provenance independently when stamping starter object hashes', () => {
    const doc = composePlaceholderMap({
      id: 'starter-provenance',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    const b = { object: 'd'.repeat(64), sourceGameId: 30, sourceTilesetId: 40 };
    const authored = {
      ...doc,
      tileset: {
        ...doc.tileset,
        slots: {
          ...doc.tileset.slots,
          A5: { object: 'c'.repeat(64), sourceGameId: 10, sourceTilesetId: 20 },
          B: b,
        },
      },
    };
    const stamped = stampPlaceholderSlotObjects(authored, {
      A5: 'a'.repeat(64),
      B: 'b'.repeat(64),
    });
    expect(stamped.tileset.slots.B).toEqual({ ...b, object: 'b'.repeat(64) });
  });

  it('rejects an overlong object hash before stamping starter slots', () => {
    const doc = composePlaceholderMap({
      id: 'starter-long-sha',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    expect(() =>
      stampPlaceholderSlotObjects(doc, { A5: 'a'.repeat(65), B: 'b'.repeat(64) }),
    ).toThrow('A5/B object shas must be 64 lowercase hex chars');
  });

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

    const ground = doc.floors[0]?.layers.tiles[0];
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

  it('rejects uppercase object shas before stamping starter slots', () => {
    const doc = composePlaceholderMap({
      id: 'starter-uppercase',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    expect(() =>
      stampPlaceholderSlotObjects(doc, { A5: 'A'.repeat(64), B: 'b'.repeat(64) }),
    ).toThrow('A5/B object shas must be 64 lowercase hex chars');
  });

  it('validates the B object sha independently of the A5 sha', () => {
    const doc = composePlaceholderMap({
      id: 'starter-invalid-b',
      name: 'Starter',
      width: 2,
      height: 2,
    });
    expect(() =>
      stampPlaceholderSlotObjects(doc, { A5: 'a'.repeat(64), B: 'g'.repeat(64) }),
    ).toThrow('A5/B object shas must be 64 lowercase hex chars');
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

it('rejects a rectangular PNG buffer missing its final scanline', () => {
  expect(() => encodeRgbaPng(1, 2, new Uint8Array(4))).toThrow(
    'encodeRgbaPng: rgba buffer shorter than width*height*4',
  );
});

it('rejects a dimensioned texture without RGBA data before creating a palette URL', () => {
  const texture = { image: { width: 1, height: 1 } } as unknown as Parameters<
    typeof textureSheetToObjectUrl
  >[0];
  expect(() => textureSheetToObjectUrl(texture)).toThrow(
    'textureSheetToObjectUrl: expected DataTexture with RGBA image.data',
  );
});

it('skips palette URL cleanup when no session exists', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    expect(() => revokePlaceholderPaletteUrls(null)).not.toThrow();
    expect(revoke).not.toHaveBeenCalled();
  } finally {
    revoke.mockRestore();
  }
});

it('uses the B sheet dimensions for its palette object URL', async () => {
  const built = buildPlaceholderTextures(2);
  try {
    const response = await fetch(built.paletteUrls.B);
    const header = new DataView(await response.arrayBuffer());
    expect([header.getUint32(16), header.getUint32(20)]).toEqual([
      built.sheetPixelSizes.B?.width,
      built.sheetPixelSizes.B?.height,
    ]);
  } finally {
    revokePlaceholderPaletteUrls(built.paletteUrls);
    built.textures.A5?.dispose();
    built.textures.B?.dispose();
  }
});

it('preserves texture pixels in the palette object URL', async () => {
  const texture = {
    image: { width: 2, height: 1, data: new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255]) },
  } as unknown as Parameters<typeof textureSheetToObjectUrl>[0];
  const url = textureSheetToObjectUrl(texture);
  try {
    const response = await fetch(url);
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    expect([...inflateSync(png.subarray(41, 41 + idatLength))]).toEqual([
      0, 10, 20, 30, 128, 40, 50, 60, 255,
    ]);
  } finally {
    URL.revokeObjectURL(url);
  }
});

it('preserves the full A5 sheet height in persisted starter PNG bytes', () => {
  const tilePixelSize = 2;
  const png = placeholderSheetPngBytes('A5', tilePixelSize);
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);

  expect([header.getUint32(16), header.getUint32(20)]).toEqual([
    PLACEHOLDER_A5_COLS * tilePixelSize,
    PLACEHOLDER_A5_ROWS * tilePixelSize,
  ]);
});

it('uses the A5 texture for its palette object URL', async () => {
  const built = buildPlaceholderTextures(2);
  try {
    const response = await fetch(built.paletteUrls.A5);
    const header = new DataView(await response.arrayBuffer());

    expect([header.getUint32(16), header.getUint32(20)]).toEqual([
      built.sheetPixelSizes.A5?.width,
      built.sheetPixelSizes.A5?.height,
    ]);
  } finally {
    revokePlaceholderPaletteUrls(built.paletteUrls);
    built.textures.A5?.dispose();
    built.textures.B?.dispose();
  }
});

it('keeps starter cells from spilling into the next pixel row', () => {
  const { width, rgba } = buildPlaceholderSheetRgba('A5', 2);
  const secondRow = width * 4;

  expect(rgba.subarray(secondRow, secondRow + 4)).toEqual(
    rgba.subarray(secondRow + 4, secondRow + 8),
  );
});

it('rejects an embedded newline in a starter object hash', () => {
  const doc = composePlaceholderMap({
    id: 'starter-multiline-hash',
    name: 'Starter',
    width: 2,
    height: 2,
  });
  const multilineHash = `${'a'.repeat(64)}\n${'b'.repeat(64)}`;

  expect(() => stampPlaceholderSlotObjects(doc, { A5: multilineHash, B: 'c'.repeat(64) })).toThrow(
    'A5/B object shas must be 64 lowercase hex chars',
  );
});

it('accepts hexadecimal zero in a starter object hash', () => {
  const doc = composePlaceholderMap({
    id: 'starter-zero-hash',
    name: 'Starter',
    width: 2,
    height: 2,
  });
  const hash = '0'.repeat(64);

  expect(
    stampPlaceholderSlotObjects(doc, { A5: hash, B: 'a'.repeat(64) }).tileset.slots.A5?.object,
  ).toBe(hash);
});

it('accepts the final hexadecimal letter in a starter object hash', () => {
  const doc = composePlaceholderMap({
    id: 'starter-final-hex-hash',
    name: 'Starter',
    width: 2,
    height: 2,
  });
  const hash = 'f'.repeat(64);

  expect(
    stampPlaceholderSlotObjects(doc, { A5: hash, B: 'a'.repeat(64) }).tileset.slots.A5?.object,
  ).toBe(hash);
});
