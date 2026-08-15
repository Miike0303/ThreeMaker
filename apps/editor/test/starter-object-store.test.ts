/**
 * Starter A5/B PNG bytes → content-addressed object store (mock fs).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type GlbIngestFs,
  type IngestBytesDeps,
  ingestBytes,
  objectPathForSha,
} from '../src/glb-ingest.js';
import { composePlaceholderMap } from '../src/map-compose.js';
import {
  placeholderSheetPngBytes,
  stampPlaceholderSlotObjects,
} from '../src/placeholder-tileset.js';

function makeFakeFs(): GlbIngestFs & {
  readonly written: Map<string, Uint8Array>;
} {
  const written = new Map<string, Uint8Array>();
  const existing = new Set<string>();
  return {
    written,
    exists: vi.fn(async (path: string) => existing.has(path) || written.has(path)),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      written.set(path, data);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const data = written.get(from);
      if (data) {
        written.delete(from);
        written.set(to, data);
      }
      existing.add(to);
    }),
  };
}

function depsOf(fs: GlbIngestFs): IngestBytesDeps {
  return { storeRoot: '/store', fs, randomSuffix: () => 'fixed' };
}

describe('starter tiles object-store stamping', () => {
  it('ingests A5 PNG bytes to a 64-hex sha under objects/{sha[0:2]}/{sha} and dedupes', async () => {
    const fs = makeFakeFs();
    const bytes = placeholderSheetPngBytes('A5');
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const first = await ingestBytes(bytes, depsOf(fs));
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.created).toBe(true);
    const path = objectPathForSha('/store', first.sha256);
    expect(path).toBe(`/store/objects/${first.sha256.slice(0, 2)}/${first.sha256}`);
    expect(fs.written.get(path)).toEqual(bytes);

    const second = await ingestBytes(bytes, depsOf(fs));
    expect(second).toEqual({ sha256: first.sha256, created: false });
  });

  it('composePlaceholderMap + stamp sets A5/B.object to 64-hex shas from ingested PNGs', async () => {
    const fs = makeFakeFs();
    const deps = depsOf(fs);
    const doc = composePlaceholderMap({
      id: 'starter-store',
      name: 'Starter',
      width: 4,
      height: 3,
    });
    expect(doc.tileset.slots.A5?.object).toBeUndefined();
    expect(doc.tileset.slots.B?.object).toBeUndefined();

    const [a5, b] = await Promise.all([
      ingestBytes(placeholderSheetPngBytes('A5'), deps),
      ingestBytes(placeholderSheetPngBytes('B'), deps),
    ]);
    const stamped = stampPlaceholderSlotObjects(doc, { A5: a5.sha256, B: b.sha256 });

    expect(stamped.tileset.slots.A5?.object).toMatch(/^[0-9a-f]{64}$/);
    expect(stamped.tileset.slots.B?.object).toMatch(/^[0-9a-f]{64}$/);
    expect(stamped.tileset.slots.A5?.object).toBe(a5.sha256);
    expect(stamped.tileset.slots.B?.object).toBe(b.sha256);
    // Unstamped compose document is unchanged.
    expect(doc.tileset.slots.A5?.object).toBeUndefined();
  });
});
