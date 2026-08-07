/**
 * Web asset provider (C9 WU-01): fetch-based seams that mirror Tauri fs reads
 * under `game/` so a static `vite build` + export payload is playable in a
 * browser without the Tauri host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rendererMocks = vi.hoisted(() => ({
  loadSheetTexture: vi.fn(async () => {
    const texture = {
      image: { width: 48, height: 96 },
    };
    return texture;
  }),
}));

vi.mock('@threemaker/renderer', () => ({
  loadSheetTexture: rendererMocks.loadSheetTexture,
}));

import {
  webReadTextFile,
  webResolveObjectBinary,
  webResolveObjectTexture,
} from '../src/web-game-source.js';

function mockResponse(init: {
  readonly ok?: boolean;
  readonly status?: number;
  readonly text?: string;
  readonly body?: ArrayBuffer;
}): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    text: async () => init.text ?? '',
    arrayBuffer: async () => init.body ?? new ArrayBuffer(0),
    blob: async () => new Blob([init.body ?? new ArrayBuffer(0)]),
  } as Response;
}

describe('web-game-source', () => {
  beforeEach(() => {
    rendererMocks.loadSheetTexture.mockClear();
  });

  describe('webReadTextFile', () => {
    it('returns null on 404 without throwing', async () => {
      const fetchImpl = vi.fn(async () => mockResponse({ status: 404, ok: false }));

      const result = await webReadTextFile('manifest.json', fetchImpl);

      expect(result).toBeNull();
      expect(fetchImpl).toHaveBeenCalledWith('game/manifest.json');
    });

    it('returns response text on success', async () => {
      const fetchImpl = vi.fn(async () => mockResponse({ status: 200, text: '{"maps":[]}' }));

      const result = await webReadTextFile('manifest.json', fetchImpl);

      expect(result).toBe('{"maps":[]}');
      expect(fetchImpl).toHaveBeenCalledWith('game/manifest.json');
    });

    it('throws on non-404 HTTP errors', async () => {
      const fetchImpl = vi.fn(async () => mockResponse({ status: 500, ok: false }));

      await expect(webReadTextFile('manifest.json', fetchImpl)).rejects.toThrow(/500/);
    });
  });

  describe('webResolveObjectBinary', () => {
    it('fetches game/asset-store/objects/{aa}/{sha} and returns Uint8Array', async () => {
      const sha = 'ab'.padEnd(64, '0');
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const fetchImpl = vi.fn(async () =>
        mockResponse({ status: 200, body: bytes.buffer.slice(0) }),
      );

      const result = await webResolveObjectBinary(sha, fetchImpl);

      expect(fetchImpl).toHaveBeenCalledWith(`game/asset-store/objects/ab/${sha}`);
      expect(result).toBeInstanceOf(Uint8Array);
      expect([...result]).toEqual([1, 2, 3, 4]);
    });

    it('throws when the object is missing', async () => {
      const sha = 'cd'.padEnd(64, 'f');
      const fetchImpl = vi.fn(async () => mockResponse({ status: 404, ok: false }));

      await expect(webResolveObjectBinary(sha, fetchImpl)).rejects.toThrow(/404/);
    });
  });

  describe('webResolveObjectTexture', () => {
    it('hits the same object URL then decodes via the sheet-texture helper', async () => {
      const sha = 'ef'.padEnd(64, 'a');
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const fetchImpl = vi.fn(async () =>
        mockResponse({ status: 200, body: bytes.buffer.slice(0) }),
      );

      const resolved = await webResolveObjectTexture(sha, fetchImpl);

      expect(fetchImpl).toHaveBeenCalledWith(`game/asset-store/objects/ef/${sha}`);
      expect(rendererMocks.loadSheetTexture).toHaveBeenCalledOnce();
      expect(resolved.width).toBe(48);
      expect(resolved.height).toBe(96);
      expect(resolved.texture).toBeDefined();
    });
  });
});
