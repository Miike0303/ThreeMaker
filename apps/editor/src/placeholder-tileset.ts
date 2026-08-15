/**
 * In-memory starter tilesheets for painting without an RPG Maker catalog.
 * Builds plain A5 (ground) + B (decor) DataTextures only — no A2 autotile layout.
 *
 * Follow-up: maps composed here omit real catalog `object` shas on slots. Save
 * works as JSON, but desktop reload cannot resolve those textures until a later
 * slice persists starter sheets into the object store (or embeds them).
 */

import type { TileSheetId } from '@threemaker/importer-rpgm';
import { configurePixelArtTexture, type SheetPixelSizes, TILE_SIZE_PX } from '@threemaker/renderer';
import * as THREE from 'three/webgpu';

/** A5 range base — first plain ground cell (matches `getTileSheet` / SLOT_ID_RANGES). */
export const PLACEHOLDER_GROUND_TILE_ID = 1536;
/** B range local index 1 (id 0 is treated as empty across this codebase). */
export const PLACEHOLDER_DECOR_TILE_ID = 1;

export const PLACEHOLDER_TILE_PIXEL_SIZE = TILE_SIZE_PX;

/** Standard RPGM A5 sheet: one 8-wide block × 16 rows @ 48px (see tile-uv A5 contract). */
export const PLACEHOLDER_A5_COLS = 8;
export const PLACEHOLDER_A5_ROWS = 16;
/** Standard RPGM B sheet: two side-by-side 8-col blocks = 16×16 @ 48px. */
export const PLACEHOLDER_B_COLS = 16;
export const PLACEHOLDER_B_ROWS = 16;

type Rgba = readonly [number, number, number, number];

const A5_EVEN: Rgba = [46, 125, 50, 255];
const A5_ODD: Rgba = [129, 199, 132, 255];
const B_EVEN: Rgba = [198, 40, 40, 255];
const B_ODD: Rgba = [255, 167, 38, 255];

export interface PlaceholderPaletteUrls {
  readonly A5: string;
  readonly B: string;
}

export interface PlaceholderTextures {
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly sheetPixelSizes: SheetPixelSizes;
  readonly paletteUrls: PlaceholderPaletteUrls;
}

function paintCell(
  data: Uint8Array,
  widthPx: number,
  col: number,
  row: number,
  tilePx: number,
  rgba: Rgba,
): void {
  const startX = col * tilePx;
  const startY = row * tilePx;
  for (let y = 0; y < tilePx; y++) {
    for (let x = 0; x < tilePx; x++) {
      const i = ((startY + y) * widthPx + (startX + x)) * 4;
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
    }
  }
}

function cellRgba(even: Rgba, odd: Rgba, col: number, row: number): Rgba {
  return (col + row) % 2 === 0 ? even : odd;
}

function buildSheetTexture(
  cols: number,
  rows: number,
  even: Rgba,
  odd: Rgba,
  tilePx: number = PLACEHOLDER_TILE_PIXEL_SIZE,
): THREE.DataTexture {
  const widthPx = cols * tilePx;
  const heightPx = rows * tilePx;
  const data = new Uint8Array(widthPx * heightPx * 4);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      paintCell(data, widthPx, col, row, tilePx, cellRgba(even, odd, col, row));
    }
  }
  const texture = new THREE.DataTexture(data, widthPx, heightPx);
  // Match TextureLoader defaults (row 0 = top), opposite of DataTexture's raw default.
  texture.flipY = true;
  texture.needsUpdate = true;
  configurePixelArtTexture(texture);
  return texture;
}

/** CRC-32 (ISO 3309 / PNG) over `bytes`. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = u32be(data.length);
  const body = concatBytes([typeBytes, data]);
  const crc = u32be(crc32(body));
  return concatBytes([len, body, crc]);
}

/**
 * Minimal uncompressed RGBA PNG encoder (no deps). Used so TilePalette can
 * take a CSS/`<img>` URL — THREE.DataTexture is not a browser image URL.
 */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (width < 1 || height < 1) {
    throw new Error(`encodeRgbaPng: invalid size ${width}x${height}`);
  }
  if (rgba.length < width * height * 4) {
    throw new Error('encodeRgbaPng: rgba buffer shorter than width*height*4');
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Filter type 0 per scanline + raw RGBA (no zlib compression: method 0 store blocks).
  const rawStride = 1 + width * 4;
  const raw = new Uint8Array(rawStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rawStride;
    raw[rowStart] = 0;
    const src = y * width * 4;
    raw.set(rgba.subarray(src, src + width * 4), rowStart + 1);
  }
  const deflated = zlibStore(raw);
  return concatBytes([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** RFC 1950 zlib wrapper around one or more non-compressed deflate stored blocks. */
function zlibStore(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks: Uint8Array[] = [];
  // CMF/FLG: deflate, 32K window, no dict, fcheck so (CMF*256+FLG) % 31 == 0.
  blocks.push(new Uint8Array([0x78, 0x01]));
  let offset = 0;
  while (offset < data.length || (offset === 0 && data.length === 0)) {
    const remaining = data.length - offset;
    const size = Math.min(maxBlock, remaining);
    const isFinal = offset + size >= data.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = isFinal; // BFINAL=1 on last, BTYPE=00 stored
    header[1] = size & 0xff;
    header[2] = (size >>> 8) & 0xff;
    const nlen = size ^ 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(header);
    if (size > 0) blocks.push(data.subarray(offset, offset + size));
    offset += size;
    if (data.length === 0) break;
  }
  const adler = adler32(data);
  blocks.push(u32be(adler));
  return concatBytes(blocks);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** PNG object URL from a DataTexture's RGBA buffer (for TilePalette CSS backgrounds). */
export function textureSheetToObjectUrl(texture: THREE.Texture): string {
  const image = texture.image as { width?: number; height?: number; data?: Uint8Array } | undefined;
  if (!image?.data || typeof image.width !== 'number' || typeof image.height !== 'number') {
    throw new Error('textureSheetToObjectUrl: expected DataTexture with RGBA image.data');
  }
  const png = encodeRgbaPng(image.width, image.height, image.data);
  // Copy into a fresh ArrayBuffer-backed view — Blob rejects SharedArrayBuffer views.
  const copy = new Uint8Array(png.byteLength);
  copy.set(png);
  return URL.createObjectURL(new Blob([copy], { type: 'image/png' }));
}

/** Revoke previous starter palette blob URLs when replacing a placeholder map session. */
export function revokePlaceholderPaletteUrls(
  urls: PlaceholderPaletteUrls | null | undefined,
): void {
  if (!urls) return;
  URL.revokeObjectURL(urls.A5);
  URL.revokeObjectURL(urls.B);
}

/**
 * Builds A5 + B starter sheets as GPU textures plus CSS-safe palette blob URLs.
 * Caller owns URL lifetime — call `revokePlaceholderPaletteUrls` on replace/unmount.
 */
export function buildPlaceholderTextures(
  tilePixelSize: number = PLACEHOLDER_TILE_PIXEL_SIZE,
): PlaceholderTextures {
  const a5 = buildSheetTexture(
    PLACEHOLDER_A5_COLS,
    PLACEHOLDER_A5_ROWS,
    A5_EVEN,
    A5_ODD,
    tilePixelSize,
  );
  const b = buildSheetTexture(PLACEHOLDER_B_COLS, PLACEHOLDER_B_ROWS, B_EVEN, B_ODD, tilePixelSize);
  const sheetPixelSizes: SheetPixelSizes = {
    A5: { width: PLACEHOLDER_A5_COLS * tilePixelSize, height: PLACEHOLDER_A5_ROWS * tilePixelSize },
    B: { width: PLACEHOLDER_B_COLS * tilePixelSize, height: PLACEHOLDER_B_ROWS * tilePixelSize },
  };
  const paletteUrls: PlaceholderPaletteUrls = {
    A5: textureSheetToObjectUrl(a5),
    B: textureSheetToObjectUrl(b),
  };
  return {
    textures: { A5: a5, B: b },
    sheetPixelSizes,
    paletteUrls,
  };
}
