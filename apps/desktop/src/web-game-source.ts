/**
 * Fetch-based game asset source for a playable static web build (C9 WU-01).
 *
 * Mirrors the Tauri Home-fs seams used by `map-file.ts` / `main.ts`:
 * - map/manifest/ink text under `game/<relative>` (export layout)
 * - asset-store objects under `game/asset-store/objects/{aa}/{sha}`
 *
 * Injectable `fetch` keeps unit tests free of a real network.
 */

import { loadSheetTexture } from '@threemaker/renderer';
import type * as THREE from 'three/webgpu';

/** URL prefix for the exported payload (sibling of the Vite bundle under `dist/`). */
export const WEB_GAME_BASE = 'game';

/** Home-relative maps dir (`map-file.ts`); stripped when translating to web paths. */
export const WEB_MAPS_HOME_PREFIX = '.threemaker/maps';

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'arrayBuffer' | 'blob'>>;

/** One decoded sheet: texture plus pixel size (same bag as Tauri resolvers). */
export interface WebResolvedTexture {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
}

/**
 * Maps a Tauri Home-relative path under `.threemaker/maps/...` to the web
 * payload path (`game/` is applied by {@link webReadTextFile}).
 */
export function homeMapsPathToWebRelative(homeRelative: string): string {
  const normalized = homeRelative.replaceAll('\\', '/').replace(/^\//, '');
  if (normalized === WEB_MAPS_HOME_PREFIX) return '';
  const prefix = `${WEB_MAPS_HOME_PREFIX}/`;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized;
}

/** `fetch('game/' + relativePath)`; 404 → null; other HTTP errors throw. */
export async function webReadTextFile(
  relativePath: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<string | null> {
  const cleaned = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  const url = `${WEB_GAME_BASE}/${cleaned}`;
  const response = await fetchImpl(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`webReadTextFile: ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Fetch a payload-relative binary (audio, today) as an `ArrayBuffer`. Mirrors
 * {@link webReadTextFile}'s `game/` prefixing; non-OK responses throw, since a
 * missing clip is a content bug the caller reports rather than silently mutes.
 */
export async function webReadBinaryFile(
  relativePath: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ArrayBuffer> {
  const cleaned = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  const url = `${WEB_GAME_BASE}/${cleaned}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`webReadBinaryFile: ${url} failed with HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

/** Asset-store object path (same `{aa}/{sha}` layout as Tauri / the catalog). */
export function webObjectUrl(sha256: string): string {
  return `${WEB_GAME_BASE}/asset-store/objects/${sha256.slice(0, 2)}/${sha256}`;
}

/** Fetch object bytes; non-OK responses throw (props need hard failure). */
export async function webResolveObjectBinary(
  sha256: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<Uint8Array> {
  const url = webObjectUrl(sha256);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`webResolveObjectBinary: ${url} failed with HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Decode PNG (or any sheet) bytes into a THREE texture via blob URL — same
 * flow as Tauri `resolveObjectTextureReal` in `main.ts` / `authored-map.ts`.
 */
export async function textureFromPngBytes(bytes: Uint8Array): Promise<WebResolvedTexture> {
  // Copy into a fresh ArrayBuffer so BlobPart typing accepts the view
  // (Uint8Array<ArrayBufferLike> from fetch is not assignable to BlobPart).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blobUrl = URL.createObjectURL(new Blob([copy], { type: 'image/png' }));
  try {
    const texture = await loadSheetTexture(blobUrl);
    const image = texture.image as { width: number; height: number };
    return { texture, width: image.width, height: image.height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Fetch object bytes and decode as a sheet texture. */
export async function webResolveObjectTexture(
  sha256: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<WebResolvedTexture> {
  const bytes = await webResolveObjectBinary(sha256, fetchImpl);
  return textureFromPngBytes(bytes);
}
