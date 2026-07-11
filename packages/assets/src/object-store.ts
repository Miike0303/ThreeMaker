import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Content-addressed object store for decrypted asset bytes. Files are
 * written under `objects/{sha256[0:2]}/{sha256}` (fan-out on the first byte
 * of the hash to avoid a single directory with 100k+ entries — see design's
 * "Catalog storage" decision). Storing the same bytes twice is a no-op after
 * the first write: the store is deduplicated by construction, since the
 * destination path is a pure function of content.
 */

const FAN_OUT_LEN = 2;

export interface StoreObjectResult {
  readonly sha256: string;
  readonly path: string;
  /** `false` when this content was already present in the store (dedupe hit). */
  readonly created: boolean;
}

/** Absolute path where `sha256`'s bytes are (or would be) stored under `storeDir`. */
export function objectPath(storeDir: string, sha256: string): string {
  return join(storeDir, 'objects', sha256.slice(0, FAN_OUT_LEN), sha256);
}

/** Hashes `bytes` and returns the hex-encoded SHA-256 digest. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Stores `bytes` under its content-addressed path within `storeDir`. If an
 * object with the same hash already exists, no write happens and `created`
 * is `false` — this is how cross-game dedupe is realized at the storage
 * layer (N references to 1 object).
 */
export function storeObject(storeDir: string, bytes: Uint8Array): StoreObjectResult {
  const sha256 = hashBytes(bytes);
  const path = objectPath(storeDir, sha256);

  if (existsSync(path)) {
    return { sha256, path, created: false };
  }

  mkdirSync(join(storeDir, 'objects', sha256.slice(0, FAN_OUT_LEN)), { recursive: true });

  // Write to a temp file in the same directory first, then atomically
  // rename it into place. Writing `path` directly would let a mid-write
  // crash leave a truncated/corrupt file exactly at the content-addressed
  // path — and because dedupe trusts `existsSync(path)` as "valid content
  // already stored" (by design, to avoid re-hashing every object on every
  // dedupe check), that corrupt file would be silently treated as good
  // forever after. A same-directory, same-volume rename is atomic on both
  // POSIX and NTFS, so `path` only ever becomes visible once the full
  // content is safely on disk.
  const tmpPath = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, bytes);
  renameSync(tmpPath, path);

  return { sha256, path, created: true };
}
