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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTextFileAtomic } from '../src/atomic-text-write.js';

describe('writeTextFileAtomic', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'threemaker-atomic-text-write-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
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
});
