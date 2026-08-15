/**
 * Browser-side port of `packages/assets`'s `storeObject` for content-addressed
 * authoring artifacts (`.glb` props, starter tilesheet PNGs, …). Pure over
 * injectable fs deps so unit tests never need Tauri; the panel wires
 * `@tauri-apps/plugin-fs` + Home-relative paths under
 * `.threemaker/asset-store/objects/**` (see the matching
 * `fs:allow-write-file` / mkdir / rename / exists grants in
 * `src-tauri/capabilities/default.json` -- the narrowest write boundary for
 * content-addressed object ingestion, mirroring maps/** write for save).
 *
 * Contract (same as Node `storeObject`):
 *  - path = `{storeRoot}/objects/{sha[0:2]}/{sha}`
 *  - dedupe by content: if the object path already exists, skip the write
 *  - otherwise mkdir recursive on the fan-out dir, write a same-dir temp
 *    sibling, then rename into place (atomic on POSIX + NTFS)
 */

const FAN_OUT_LEN = 2;
/** Binary glTF container magic (`glTF` ASCII). */
const GLB_MAGIC = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

export class GlbIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlbIngestError';
  }
}

/** Injectable filesystem surface -- mirrors the ops Node `storeObject` uses. */
export interface GlbIngestFs {
  readonly exists: (path: string) => Promise<boolean>;
  readonly mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
}

export interface IngestBytesDeps {
  /** Absolute or relative root of the asset store (the directory that contains `objects/`). */
  readonly storeRoot: string;
  readonly fs: GlbIngestFs;
  /** Suffix for the temp sibling path; injectable so tests can pin the name. */
  readonly randomSuffix?: () => string;
}

/** @deprecated Prefer `IngestBytesDeps` — kept as an alias for existing glb call sites. */
export type IngestGlbDeps = IngestBytesDeps;

export interface IngestBytesResult {
  readonly sha256: string;
  /** `false` when this content was already present (dedupe hit). */
  readonly created: boolean;
}

/** @deprecated Prefer `IngestBytesResult` — kept as an alias for existing glb call sites. */
export type IngestGlbResult = IngestBytesResult;

/** Content-addressed object path under `storeRoot`, matching Node `objectPath`. */
export function objectPathForSha(storeRoot: string, sha256: string): string {
  const root = storeRoot.replace(/[/\\]+$/, '');
  return `${root}/objects/${sha256.slice(0, FAN_OUT_LEN)}/${sha256}`;
}

/** Hex-encoded SHA-256 of `bytes` via Web Crypto (`crypto.subtle.digest`). */
export async function hashBytesSha256(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: `subtle.digest` rejects some
  // SharedArrayBuffer / offset views depending on the host, and vitest's
  // Node crypto path is happier with a plain buffer slice.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function assertGlbMagic(bytes: Uint8Array): void {
  if (bytes.byteLength < 4) {
    throw new GlbIngestError(
      `Not a binary .glb: expected "glTF" magic in the first 4 bytes, got only ${bytes.byteLength} byte(s).`,
    );
  }
  if (
    bytes[0] !== GLB_MAGIC[0] ||
    bytes[1] !== GLB_MAGIC[1] ||
    bytes[2] !== GLB_MAGIC[2] ||
    bytes[3] !== GLB_MAGIC[3]
  ) {
    const got = Array.from(bytes.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join(' ');
    throw new GlbIngestError(
      `Not a binary .glb: first 4 bytes must be the "glTF" magic (67 6c 54 46), got ${got}.`,
    );
  }
}

/**
 * Content-addresses `bytes` and stores them under the asset-store object tree
 * with no format gate. Dedupe: if the object path already exists, returns
 * without writing.
 */
export async function ingestBytes(
  bytes: Uint8Array,
  deps: IngestBytesDeps,
): Promise<IngestBytesResult> {
  const sha256 = await hashBytesSha256(bytes);
  const path = objectPathForSha(deps.storeRoot, sha256);

  if (await deps.fs.exists(path)) {
    return { sha256, created: false };
  }

  const fanOutDir = path.slice(0, path.lastIndexOf('/'));
  await deps.fs.mkdir(fanOutDir, { recursive: true });

  // Same-directory temp + rename (atomic on POSIX and NTFS) so a mid-write
  // crash never leaves a truncated file at the content-addressed path that
  // dedupe would later treat as valid forever.
  const suffix = deps.randomSuffix?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpPath = `${path}.tmp-${suffix}`;
  await deps.fs.writeFile(tmpPath, bytes);
  await deps.fs.rename(tmpPath, path);

  return { sha256, created: true };
}

/** Alias of `ingestBytes` matching the Node `storeObject` name. */
export const storeObjectBytes = ingestBytes;

/**
 * Validates the glb container magic, then content-addresses and stores `bytes`
 * under the asset-store object tree. Rejects non-glb input BEFORE any write.
 */
export async function ingestGlbBytes(
  bytes: Uint8Array,
  deps: IngestGlbDeps,
): Promise<IngestGlbResult> {
  assertGlbMagic(bytes);
  return ingestBytes(bytes, deps);
}
