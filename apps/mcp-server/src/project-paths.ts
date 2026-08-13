import { isAbsolute, posix, relative, resolve, win32 } from 'node:path';

function isEscapingRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0) {
    return true;
  }
  if (/^[A-Za-z]:/.test(relativePath)) {
    return true;
  }
  if (
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    posix.isAbsolute(relativePath)
  ) {
    return true;
  }
  if (relativePath.startsWith('\\\\') || relativePath.startsWith('//')) {
    return true;
  }
  return relativePath.split(/[\\/]+/).includes('..');
}

/**
 * Resolve `relativePath` under `rootPath`, or throw if it is absolute, has a
 * drive letter, contains `..`, or otherwise escapes the project root.
 */
export function resolveInsideProject(rootPath: string, relativePath: string): string {
  if (isEscapingRelativePath(relativePath)) {
    throw new Error(`Path '${relativePath}' is outside the project root.`);
  }
  const root = resolve(rootPath);
  const resolved = resolve(root, relativePath);
  const rel = relative(root, resolved);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel) || win32.isAbsolute(rel)) {
    throw new Error(`Path '${relativePath}' is outside the project root.`);
  }
  return resolved;
}
