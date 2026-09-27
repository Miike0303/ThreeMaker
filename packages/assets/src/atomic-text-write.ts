import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

// ponytail: packages/assets type-checks against its own node shim (src/global.d.ts),
// which at HEAD lacks these four members. Declared here, with signatures identical
// to the shim's pending additions, so this module builds on its own; drop this
// block once global.d.ts declares them.
declare module 'node:fs' {
  export function openSync(path: string, flags: 'wx' | 'r'): number;
  export function closeSync(descriptor: number): void;
  export function unlinkSync(path: string): void;
}
declare module 'node:crypto' {
  export function randomUUID(): string;
}

export function writeTextFileAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${randomUUID()}`;
  let owned = false;
  try {
    const fd = openSync(tmp, 'wx');
    owned = true;
    closeSync(fd);
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    if (owned) {
      try {
        unlinkSync(tmp);
      } catch {
        // Preserve the original error.
      }
    }
    throw error;
  }
}
