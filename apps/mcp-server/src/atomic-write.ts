import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 20;
const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function isRetryableRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    RETRYABLE_RENAME_CODES.has((error as { code: string }).code)
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function unlinkBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Never mask the original write/rename error.
  }
}

function renameWithRetry(tmpPath: string, targetPath: string): void {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === RENAME_ATTEMPTS) {
        throw error;
      }
      sleepSync(RENAME_RETRY_MS);
    }
  }
}

/**
 * Write `contents` to `targetPath` via a same-directory temp file + rename.
 * `renameSync` replaces an existing target on Windows. Transient lock errors
 * (`EBUSY`, `EPERM`, `EACCES`) are retried a few times. There is no copy
 * fallback: if rename cannot complete, this throws and the target is left
 * untouched.
 */
export function writeFileAtomic(targetPath: string, contents: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tmpPath, contents, 'utf8');
  try {
    renameWithRetry(tmpPath, targetPath);
  } catch (error) {
    unlinkBestEffort(tmpPath);
    throw error;
  }
}
