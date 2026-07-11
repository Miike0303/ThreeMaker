import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBytes, objectPath, storeObject } from '../src/object-store.js';

// `renameSync` is the seam we need to fail deterministically to prove the
// atomic-write invariant below. ESM module namespaces aren't configurable
// (vi.spyOn can't redefine an export in place), so we mock the whole
// `node:fs` module and pass every other export through unchanged.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('object-store', () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'threemaker-object-store-'));
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('stores bytes under objects/{sha[0:2]}/{sha256} and returns the hash', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex');

    const result = storeObject(storeDir, bytes);

    expect(result.sha256).toBe(expectedSha256);
    expect(result.created).toBe(true);
    expect(result.path).toBe(objectPath(storeDir, expectedSha256));
    expect(result.path.replace(/\\/g, '/')).toContain(
      `objects/${expectedSha256.slice(0, 2)}/${expectedSha256}`,
    );

    const onDisk = readFileSync(result.path);
    expect(new Uint8Array(onDisk)).toEqual(bytes);
  });

  it('returns the existing hash without rewriting when the same content is stored twice', () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);

    const first = storeObject(storeDir, bytes);
    const second = storeObject(storeDir, bytes);

    expect(second.sha256).toBe(first.sha256);
    expect(second.path).toBe(first.path);
    expect(second.created).toBe(false);
  });

  it('stores different content under different hashes', () => {
    const a = storeObject(storeDir, new Uint8Array([1]));
    const b = storeObject(storeDir, new Uint8Array([2]));

    expect(a.sha256).not.toBe(b.sha256);
    expect(a.path).not.toBe(b.path);
  });

  it('never leaves a partial/corrupt file at the final path if the atomic rename step fails (simulated crash)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const finalPath = objectPath(storeDir, hashBytes(bytes));

    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('simulated crash during atomic rename');
    });

    expect(() => storeObject(storeDir, bytes)).toThrow('simulated crash during atomic rename');

    // The write-to-temp step may have completed, but the rename that would
    // expose those bytes at the real destination never did — proving a
    // crash here leaves NO trace at the final content-addressed path
    // (unlike a direct write, where an interrupted write could leave a
    // truncated file exactly at this path, which future dedupe checks would
    // then silently trust as "already stored").
    expect(existsSync(finalPath)).toBe(false);
  });

  it('produces a complete, correct file at the final path on a normal (non-crashing) write', () => {
    const bytes = new Uint8Array(64).map((_, i) => i);

    const result = storeObject(storeDir, bytes);

    expect(existsSync(result.path)).toBe(true);
    expect(new Uint8Array(readFileSync(result.path))).toEqual(bytes);
  });
});
