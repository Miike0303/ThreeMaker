import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { objectPath, storeObject } from '../src/object-store.js';

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
});
