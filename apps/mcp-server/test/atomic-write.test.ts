import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../src/atomic-write.js';

const fsActual = await vi.importActual<typeof import('node:fs')>('node:fs');

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
  };
});

function errno(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-mcp-atomic-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.mocked(renameSync).mockImplementation(fsActual.renameSync);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function leftoverTemps(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

describe('writeFileAtomic', () => {
  it('writes the full contents to a new file and leaves no temp sibling', () => {
    const root = makeRoot();
    const target = join(root, 'map.tmmap.json');
    writeFileAtomic(target, '{"ok":true}');
    expect(readFileSync(target, 'utf8')).toBe('{"ok":true}');
    expect(leftoverTemps(root)).toEqual([]);
  });

  it('overwrites an existing file without leaving a temp sibling', () => {
    const root = makeRoot();
    const target = join(root, 'map.tmmap.json');
    writeFileSync(target, 'old');
    writeFileAtomic(target, 'new-contents');
    expect(readFileSync(target, 'utf8')).toBe('new-contents');
    expect(leftoverTemps(root)).toEqual([]);
  });

  it('creates missing parent directories', () => {
    const root = makeRoot();
    const target = join(root, 'maps', 'town.tmmap.json');
    writeFileAtomic(target, '{}');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('{}');
  });

  it('throws, leaves the target byte-identical, and leaves no temp when rename cannot succeed', () => {
    const root = makeRoot();
    const target = join(root, 'map.tmmap.json');
    const original = Buffer.from([0x7b, 0x22, 0x6f, 0x6c, 0x64, 0x22, 0x3a, 0x31, 0x00, 0xff]);
    writeFileSync(target, original);
    vi.mocked(renameSync).mockImplementation(() => {
      throw errno('EBUSY', 'resource busy or locked');
    });

    expect(() => writeFileAtomic(target, 'new-contents')).toThrow(/EBUSY|busy or locked/i);
    expect(readFileSync(target)).toEqual(original);
    expect(leftoverTemps(root)).toEqual([]);
  });

  it('retries a transient rename lock and then replaces the target', () => {
    const root = makeRoot();
    const target = join(root, 'map.tmmap.json');
    writeFileSync(target, 'old');
    let attempts = 0;
    vi.mocked(renameSync).mockImplementation((from, to) => {
      attempts += 1;
      if (attempts < 3) {
        throw errno('EBUSY', 'resource busy or locked');
      }
      fsActual.renameSync(from, to);
    });

    writeFileAtomic(target, 'new-contents');
    expect(readFileSync(target, 'utf8')).toBe('new-contents');
    expect(leftoverTemps(root)).toEqual([]);
    expect(attempts).toBe(3);
  });
});
