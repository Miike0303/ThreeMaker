import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeTextFileAtomic } from '../src/atomic-text-write.js';

const failureState = vi.hoisted(() => ({
  error: Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }),
  failTempWrite: false,
  uuid: null as string | null,
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => failureState.uuid ?? actual.randomUUID() };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const originalWriteFileSync = actual.writeFileSync;

  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof originalWriteFileSync>) => {
      const [path, data] = args;
      if (failureState.failTempWrite && typeof path === 'string' && path.includes('.tmp-')) {
        const partial =
          typeof data === 'string' ? data.slice(0, Math.max(1, Math.floor(data.length / 2))) : data;
        originalWriteFileSync(path, partial, 'utf8');
        throw failureState.error;
      }

      return originalWriteFileSync(...args);
    },
  };
});

describe('writeTextFileAtomic', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'threemaker-atomic-text-write-'));
  });

  afterEach(() => {
    failureState.failTempWrite = false;
    failureState.uuid = null;
    rmSync(directory, { recursive: true, force: true });
  });

  it('preserves a temporary file it did not create when its name collides', () => {
    failureState.uuid = 'collision';
    const path = join(directory, 'manifest.json');
    const tempPath = `${path}.tmp-collision`;
    writeFileSync(path, 'previous content', 'utf8');
    writeFileSync(tempPath, 'other writer content', 'utf8');

    expect(() => writeTextFileAtomic(path, 'replacement')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('previous content');
    expect(readFileSync(tempPath, 'utf8')).toBe('other writer content');
  });

  it('creates a file with exact content and leaves no temporary sibling', () => {
    const path = join(directory, 'map.tmmap.json');
    const text = '{"name":"Forest 🌲"}\n';

    writeTextFileAtomic(path, text);

    expect(readFileSync(path, 'utf8')).toBe(text);
    expect(readdirSync(directory)).toEqual(['map.tmmap.json']);
  });

  it('replaces the content of an existing file', () => {
    const path = join(directory, 'manifest.json');
    writeFileSync(path, 'previous content', 'utf8');

    writeTextFileAtomic(path, 'new content');

    expect(readFileSync(path, 'utf8')).toBe('new content');
    expect(readdirSync(directory)).toEqual(['manifest.json']);
  });

  it('preserves an existing directory and removes the temporary sibling when rename fails', () => {
    const path = join(directory, 'map.tmmap.json');
    mkdirSync(path);
    const existingFile = join(path, 'existing.txt');
    writeFileSync(existingFile, 'preserved content', 'utf8');

    expect(() => writeTextFileAtomic(path, 'new content')).toThrow();

    expect(statSync(path).isDirectory()).toBe(true);
    expect(readdirSync(path)).toEqual(['existing.txt']);
    expect(readFileSync(existingFile, 'utf8')).toBe('preserved content');
    expect(readdirSync(directory)).toEqual(['map.tmmap.json']);
  });

  it('preserves the destination when writing the temporary file fails', () => {
    const path = join(directory, 'map.tmmap.json');
    const seed = Buffer.from([0x00, 0x7f, 0xff, 0x10, 0x0a]);
    writeFileSync(path, seed);
    failureState.failTempWrite = true;
    let thrown: unknown;
    try {
      writeTextFileAtomic(path, 'replacement content');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failureState.error);
    expect(readFileSync(path)).toEqual(seed);
    expect(readdirSync(directory)).toEqual(['map.tmmap.json']);
  });
});
