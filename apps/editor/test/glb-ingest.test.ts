import { describe, expect, it, vi } from 'vitest';
import {
  GlbIngestError,
  type GlbIngestFs,
  hashBytesSha256,
  type IngestGlbDeps,
  ingestGlbBytes,
  objectPathForSha,
} from '../src/glb-ingest.js';

/** Minimal byte sequence starting with the binary glTF magic (not a full glb). */
const GLB_BYTES = new Uint8Array([
  0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
/** Precomputed SHA-256 of `GLB_BYTES` (Node crypto, fixed vector for this WU). */
const GLB_SHA256 = 'd1169383004dc21493073903d918af69ad087b1778746e2db7dac83077f3cfc6';

function makeFakeFs(options: { existing?: ReadonlySet<string> } = {}): GlbIngestFs & {
  readonly calls: string[];
  readonly written: Map<string, Uint8Array>;
} {
  const existing = new Set(options.existing ?? []);
  const written = new Map<string, Uint8Array>();
  const calls: string[] = [];
  return {
    calls,
    written,
    exists: vi.fn(async (path: string) => {
      calls.push(`exists:${path}`);
      return existing.has(path) || written.has(path);
    }),
    mkdir: vi.fn(async (path: string, opts: { recursive: boolean }) => {
      calls.push(`mkdir:${path}:recursive=${opts.recursive}`);
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      calls.push(`writeFile:${path}`);
      written.set(path, data);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      calls.push(`rename:${from}->${to}`);
      const data = written.get(from);
      if (data) {
        written.delete(from);
        written.set(to, data);
      }
      existing.add(to);
    }),
  };
}

function depsOf(fs: GlbIngestFs, overrides: Partial<IngestGlbDeps> = {}): IngestGlbDeps {
  return {
    storeRoot: '/store',
    fs,
    randomSuffix: () => 'fixed',
    ...overrides,
  };
}

describe('hashBytesSha256 / objectPathForSha', () => {
  it('matches the known SHA-256 vector for a fixed glb-magic payload', async () => {
    expect(await hashBytesSha256(GLB_BYTES)).toBe(GLB_SHA256);
  });

  it('builds objects/{sha[0:2]}/{sha} under storeRoot', () => {
    expect(objectPathForSha('/store', GLB_SHA256)).toBe(
      `/store/objects/${GLB_SHA256.slice(0, 2)}/${GLB_SHA256}`,
    );
    expect(objectPathForSha('/store/', GLB_SHA256)).toBe(
      `/store/objects/${GLB_SHA256.slice(0, 2)}/${GLB_SHA256}`,
    );
  });
});

describe('ingestGlbBytes', () => {
  it('rejects non-glb magic BEFORE any fs write', async () => {
    const fs = makeFakeFs();
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);

    await expect(ingestGlbBytes(bad, depsOf(fs))).rejects.toThrow(GlbIngestError);
    await expect(ingestGlbBytes(bad, depsOf(fs))).rejects.toThrow(/glTF/);
    expect(fs.calls).toEqual([]);
    expect(fs.written.size).toBe(0);
  });

  it('rejects an empty buffer with a clear magic error and writes nothing', async () => {
    const fs = makeFakeFs();
    await expect(ingestGlbBytes(new Uint8Array(), depsOf(fs))).rejects.toThrow(/glTF/);
    expect(fs.calls).toEqual([]);
  });

  it('hashes, mkdirs recursively first, then writes temp + renames atomically', async () => {
    const fs = makeFakeFs();
    const result = await ingestGlbBytes(GLB_BYTES, depsOf(fs));

    const finalPath = objectPathForSha('/store', GLB_SHA256);
    const fanOutDir = `/store/objects/${GLB_SHA256.slice(0, 2)}`;
    const tmpPath = `${finalPath}.tmp-fixed`;

    expect(result).toEqual({ sha256: GLB_SHA256, created: true });
    expect(fs.calls).toEqual([
      `exists:${finalPath}`,
      `mkdir:${fanOutDir}:recursive=true`,
      `writeFile:${tmpPath}`,
      `rename:${tmpPath}->${finalPath}`,
    ]);
    expect(fs.written.get(finalPath)).toEqual(GLB_BYTES);
  });

  it('dedupes: skips mkdir/write/rename entirely when the object path already exists', async () => {
    const finalPath = objectPathForSha('/store', GLB_SHA256);
    const fs = makeFakeFs({ existing: new Set([finalPath]) });

    const result = await ingestGlbBytes(GLB_BYTES, depsOf(fs));

    expect(result).toEqual({ sha256: GLB_SHA256, created: false });
    expect(fs.calls).toEqual([`exists:${finalPath}`]);
    expect(fs.written.size).toBe(0);
  });
});
