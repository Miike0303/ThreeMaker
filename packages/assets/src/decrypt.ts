/**
 * Native decryption for RPG Maker MV/MZ's asset "encryption" scheme.
 *
 * Format (verified byte-for-byte against a real installed game — see
 * `test/decrypt.real.test.ts`): the first 16 bytes are a fake header (ASCII
 * `RPGMV` + a version byte + reserved bytes, always the same regardless of
 * the real file type). The next 16 bytes are the start of the real file,
 * XOR-ed with the raw 16-byte key from `System.json.encryptionKey` (a
 * 32-hex-char string). Every byte after that is verbatim. This is a fixed
 * XOR, not a stream cipher — trivially reversible once the scheme is known,
 * which is why RPG Maker calls it "encryption" only loosely.
 */

const FAKE_HEADER_LEN = 16;
const XOR_LEN = 16;
const KEY_LEN = 16;

// ASCII "RPGMV" — the first 5 bytes of the fake header are always this,
// regardless of the wrapped file's real type.
const FAKE_HEADER_MAGIC: readonly number[] = [0x52, 0x50, 0x47, 0x4d, 0x56];

// Known magic bytes for the asset types RPG Maker encrypts.
const PNG_MAGIC: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OGG_MAGIC: readonly number[] = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const M4A_FTYP_MAGIC: readonly number[] = [0x66, 0x74, 0x79, 0x70]; // "ftyp", at offset 4
const M4A_FTYP_OFFSET = 4;

export type DecryptErrorCode = 'bad-header' | 'truncated' | 'bad-key' | 'magic-mismatch';

export class DecryptError extends Error {
  readonly code: DecryptErrorCode;

  constructor(code: DecryptErrorCode, message: string) {
    super(message);
    this.name = 'DecryptError';
    this.code = code;
  }
}

function bytesMatchAt(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (data[offset + i] !== expected[i]) return false;
  }
  return true;
}

function hasKnownMagic(data: Uint8Array): boolean {
  return (
    bytesMatchAt(data, 0, PNG_MAGIC) ||
    bytesMatchAt(data, 0, OGG_MAGIC) ||
    bytesMatchAt(data, M4A_FTYP_OFFSET, M4A_FTYP_MAGIC)
  );
}

/**
 * Parses `System.json.encryptionKey` (a 32-hex-char string) into 16 raw key
 * bytes. Returns `null` when the field is absent, empty, or not a valid
 * 32-hex-char string — callers should treat `null` as "this game's assets
 * are not encrypted" rather than an error.
 */
export function parseEncryptionKey(systemJson: unknown): Uint8Array | null {
  if (typeof systemJson !== 'object' || systemJson === null) return null;

  const key = (systemJson as Record<string, unknown>).encryptionKey;
  if (typeof key !== 'string' || !/^[0-9a-fA-F]{32}$/.test(key)) return null;

  const bytes = new Uint8Array(KEY_LEN);
  for (let i = 0; i < KEY_LEN; i++) {
    bytes[i] = Number.parseInt(key.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Decrypts an RPG Maker MV/MZ asset (`.rpgmvp`/`.png_` images,
 * `.rpgmvo`/`.ogg_`/`.m4a_` audio — same algorithm for all of them). Strips
 * the 16-byte fake header, XORs the next 16 bytes with `key`, and verifies
 * the result against known magic bytes before returning it.
 *
 * @throws {DecryptError} with a specific `code`:
 * - `truncated`: `data` is shorter than the fake header + XOR block.
 * - `bad-header`: the fake header's magic bytes don't match `RPGMV`.
 * - `bad-key`: `key` is not exactly 16 bytes.
 * - `magic-mismatch`: the decrypted output doesn't match any known asset
 *   magic (PNG, OGG, or M4A `ftyp`) — the key is likely wrong.
 */
export function decryptRpgmv(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (data.length < FAKE_HEADER_LEN + XOR_LEN) {
    throw new DecryptError('truncated', `Encrypted asset is too short (${data.length} bytes).`);
  }
  if (!bytesMatchAt(data, 0, FAKE_HEADER_MAGIC)) {
    throw new DecryptError('bad-header', 'Fake RPGMV header magic is missing or corrupt.');
  }
  if (key.length !== KEY_LEN) {
    throw new DecryptError(
      'bad-key',
      `Encryption key must be ${KEY_LEN} bytes, got ${key.length}.`,
    );
  }

  const decryptedChunk = new Uint8Array(XOR_LEN);
  for (let i = 0; i < XOR_LEN; i++) {
    decryptedChunk[i] = (data[FAKE_HEADER_LEN + i] ?? 0) ^ (key[i] ?? 0);
  }

  const rest = data.subarray(FAKE_HEADER_LEN + XOR_LEN);
  const output = new Uint8Array(decryptedChunk.length + rest.length);
  output.set(decryptedChunk, 0);
  output.set(rest, decryptedChunk.length);

  if (!hasKnownMagic(output)) {
    throw new DecryptError(
      'magic-mismatch',
      'Decrypted output does not match any known asset magic bytes — the key is likely wrong.',
    );
  }

  return output;
}
