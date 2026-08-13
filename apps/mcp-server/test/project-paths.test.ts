import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInsideProject } from '../src/project-paths.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-mcp-paths-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveInsideProject', () => {
  it('rejects a .. traversal relativePath', () => {
    const root = makeRoot();
    expect(() => resolveInsideProject(root, '../secret.tmmap.json')).toThrow(/project root/i);
  });

  it('rejects nested .. segments that would escape the project root', () => {
    const root = makeRoot();
    expect(() => resolveInsideProject(root, 'maps/../../outside.tmmap.json')).toThrow(
      /project root/i,
    );
  });

  it('rejects absolute paths', () => {
    const root = makeRoot();
    expect(() => resolveInsideProject(root, '/etc/passwd')).toThrow(/project root/i);
  });

  it('rejects Windows drive-letter paths', () => {
    const root = makeRoot();
    expect(() => resolveInsideProject(root, 'C:\\Windows\\evil.tmmap.json')).toThrow(
      /project root/i,
    );
    expect(() => resolveInsideProject(root, 'D:evil.tmmap.json')).toThrow(/project root/i);
  });

  it('resolves a contained relative path under the project root', () => {
    const root = makeRoot();
    const resolved = resolveInsideProject(root, 'maps/town.tmmap.json');
    expect(resolved).toBe(resolve(root, 'maps/town.tmmap.json'));
  });
});
