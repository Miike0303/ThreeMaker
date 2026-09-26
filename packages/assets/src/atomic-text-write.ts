import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

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
