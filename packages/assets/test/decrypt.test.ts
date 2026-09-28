import { describe, expect, it } from 'vitest';
import { DecryptError, decryptRpgmv, parseEncryptionKey } from '../src/decrypt.js';

const KEY_HEX = 'd41d8cd98f00b204e9800998ecf8427e';
const KEY_BYTES = hexToBytes(KEY_HEX);

const FAKE_HEADER = new Uint8Array([
  0x52, 0x50, 0x47, 0x4d, 0x56, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53];

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function xor16(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = (plain[i] ?? 0) ^ (key[i] ?? 0);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encrypts a synthetic "plain" asset the same way RPG Maker does, for round-trip tests. */
function encryptFixture(plainBytes: Uint8Array, key: Uint8Array): Uint8Array {
  const first16 = plainBytes.subarray(0, 16);
  const rest = plainBytes.subarray(16);
  return concat(FAKE_HEADER, xor16(first16, key), rest);
}

describe('parseEncryptionKey', () => {
  it('parses a 32-hex-char encryptionKey into 16 raw key bytes', () => {
    const key = parseEncryptionKey({ encryptionKey: KEY_HEX });
    expect(key).toEqual(KEY_BYTES);
  });

  it('parses uppercase hexadecimal encryption keys', () => {
    expect(parseEncryptionKey({ encryptionKey: KEY_HEX.toUpperCase() })).toEqual(KEY_BYTES);
  });

  it('parses a different key into different bytes (triangulation)', () => {
    const otherHex = '00112233445566778899aabbccddeeff'.slice(0, 32);
    const key = parseEncryptionKey({ encryptionKey: otherHex });
    expect(key).toEqual(hexToBytes(otherHex));
    expect(key).not.toEqual(KEY_BYTES);
  });

  it('returns null when encryptionKey is absent, empty, or not valid hex', () => {
    expect(parseEncryptionKey({})).toBeNull();
    expect(parseEncryptionKey({ encryptionKey: '' })).toBeNull();
    expect(parseEncryptionKey({ encryptionKey: 'not-hex-at-all!!' })).toBeNull();
    expect(parseEncryptionKey(null)).toBeNull();
  });

  it('rejects an encryption key with extra hexadecimal digits', () => {
    expect(parseEncryptionKey({ encryptionKey: `${KEY_HEX}ff` })).toBeNull();
  });

  it('rejects an encryption key with only 31 hexadecimal digits', () => {
    expect(parseEncryptionKey({ encryptionKey: KEY_HEX.slice(0, 31) })).toBeNull();
  });

  it('rejects a 32-character encryption key containing g', () => {
    expect(parseEncryptionKey({ encryptionKey: `${KEY_HEX.slice(0, 31)}g` })).toBeNull();
  });

  it('rejects an encryption key containing uppercase G', () => {
    expect(parseEncryptionKey({ encryptionKey: `${KEY_HEX.slice(0, 31)}G` })).toBeNull();
  });

  it('rejects a valid-looking encryption key on a later line', () => {
    expect(parseEncryptionKey({ encryptionKey: `invalid\n${KEY_HEX}` })).toBeNull();
  });
});

describe('decryptRpgmv', () => {
  it('decrypts a synthetic PNG fixture back to its original bytes', () => {
    const plain = concat(
      new Uint8Array(PNG_MAGIC),
      new Uint8Array([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]),
      new TextEncoder().encode('synthetic-png-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts a synthetic OGG fixture back to its original bytes (triangulation)', () => {
    const plain = concat(
      new Uint8Array(OGG_MAGIC),
      new Uint8Array([0, 2, 0, 0]),
      new TextEncoder().encode('synthetic-ogg-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts an M4A fixture with ftyp at offset 4 back to its original bytes', () => {
    const plain = concat(
      new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]),
      new TextEncoder().encode('synthetic-m4a-tail'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('throws DecryptError(bad-header) when the fake header magic is wrong', () => {
    const bogus = concat(new TextEncoder().encode('NOTRPGMV........'), new Uint8Array(16));

    expect(() => decryptRpgmv(bogus, KEY_BYTES)).toThrow(DecryptError);
    try {
      decryptRpgmv(bogus, KEY_BYTES);
      expect.unreachable('expected decryptRpgmv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DecryptError);
      expect((err as DecryptError).code).toBe('bad-header');
    }
  });

  it('rejects an RPGMV header with a corrupt fifth magic byte', () => {
    const plain = concat(new Uint8Array(PNG_MAGIC), new Uint8Array(8));
    const encrypted = encryptFixture(plain, KEY_BYTES);
    encrypted[4] = 0;

    expect(() => decryptRpgmv(encrypted, KEY_BYTES)).toThrowError(
      expect.objectContaining({ code: 'bad-header' }),
    );
  });

  it('throws DecryptError(truncated) when data is shorter than header+xor block', () => {
    const short = concat(FAKE_HEADER, new Uint8Array([1, 2, 3]));

    expect(() => decryptRpgmv(short, KEY_BYTES)).toThrow(DecryptError);
    try {
      decryptRpgmv(short, KEY_BYTES);
      expect.unreachable('expected decryptRpgmv to throw');
    } catch (err) {
      expect((err as DecryptError).code).toBe('truncated');
    }
  });

  it('throws DecryptError(bad-key) when the key is not 16 bytes', () => {
    const plain = concat(new Uint8Array(PNG_MAGIC), new Uint8Array(24));
    const encrypted = encryptFixture(plain, KEY_BYTES);
    const shortKey = KEY_BYTES.subarray(0, 8);

    expect(() => decryptRpgmv(encrypted, shortKey)).toThrow(DecryptError);
    try {
      decryptRpgmv(encrypted, shortKey);
      expect.unreachable('expected decryptRpgmv to throw');
    } catch (err) {
      expect((err as DecryptError).code).toBe('bad-key');
    }
  });

  it('rejects an encryption key longer than 16 bytes', () => {
    const plain = concat(new Uint8Array(PNG_MAGIC), new Uint8Array(16));
    const encrypted = encryptFixture(plain, KEY_BYTES);
    const longKey = concat(KEY_BYTES, new Uint8Array([0]));

    expect(() => decryptRpgmv(encrypted, longKey)).toThrowError(
      expect.objectContaining({ code: 'bad-key' }),
    );
  });

  it('reports the supplied key length when rejecting a short key', () => {
    const plain = concat(new Uint8Array(PNG_MAGIC), new Uint8Array(8));
    const encrypted = encryptFixture(plain, KEY_BYTES);
    const shortKey = KEY_BYTES.subarray(0, 15);

    expect(() => decryptRpgmv(encrypted, shortKey)).toThrowError(
      expect.objectContaining({
        code: 'bad-key',
        message: 'Encryption key must be 16 bytes, got 15.',
      }),
    );
  });

  it('identifies truncated assets as DecryptError in diagnostic text', () => {
    let error: unknown;
    try {
      decryptRpgmv(new Uint8Array(0), KEY_BYTES);
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toBe('DecryptError: Encrypted asset is too short (0 bytes).');
  });

  it('throws DecryptError(magic-mismatch) when decrypted output matches no known magic', () => {
    const plain = concat(new Uint8Array(8), new Uint8Array(16));
    const encrypted = encryptFixture(plain, KEY_BYTES);

    expect(() => decryptRpgmv(encrypted, KEY_BYTES)).toThrow(DecryptError);
    try {
      decryptRpgmv(encrypted, KEY_BYTES);
      expect.unreachable('expected decryptRpgmv to throw');
    } catch (err) {
      expect((err as DecryptError).code).toBe('magic-mismatch');
    }
  });

  it('decrypts a JPEG renamed .png_ back to its original bytes (real games ship JPEG under the PNG extension)', () => {
    const plain = concat(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      new TextEncoder().encode('synthetic-jpeg-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('rejects a JPEG start marker with a corrupt third byte', () => {
    const plain = concat(new Uint8Array([0xff, 0xd8, 0x00]), new Uint8Array(13));
    const encrypted = encryptFixture(plain, KEY_BYTES);

    expect(() => decryptRpgmv(encrypted, KEY_BYTES)).toThrowError(
      expect.objectContaining({ code: 'magic-mismatch' }),
    );
  });

  it('decrypts a GIF renamed .png_ back to its original bytes (real games ship GIF under the PNG extension)', () => {
    const plain = concat(
      new TextEncoder().encode('GIF8'),
      new TextEncoder().encode('9a-synthetic-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts a WebP renamed .png_ back to its original bytes (real games ship WebP under the PNG extension)', () => {
    // RIFF....WEBP -- the WEBP fourcc sits at offset 8, RIFF at offset 0.
    const plain = concat(
      new TextEncoder().encode('RIFF'),
      new Uint8Array([0x1a, 0, 0, 0]), // chunk size, arbitrary
      new TextEncoder().encode('WEBP'),
      new TextEncoder().encode('VP8X-synthetic-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts a WAV renamed .ogg_ back to its original bytes (triangulation for the RIFF family)', () => {
    // RIFF....WAVE
    const plain = concat(
      new TextEncoder().encode('RIFF'),
      new Uint8Array([0x24, 0, 0, 0]),
      new TextEncoder().encode('WAVE'),
      new TextEncoder().encode('fmt -synthetic-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts an MP3 (ID3 tag) renamed .ogg_ back to its original bytes', () => {
    const plain = concat(
      new TextEncoder().encode('ID3'),
      new Uint8Array([3, 0, 0, 0, 0, 0, 0]),
      new TextEncoder().encode('synthetic-mp3-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('decrypts an MP3 (raw frame sync, no ID3 tag) renamed .ogg_ back to its original bytes', () => {
    // 0xFF followed by a byte with the top 3 bits set (0xE0 mask) is a valid
    // MPEG frame sync -- games sometimes ship MP3s with no ID3 tag at all.
    const plain = concat(
      new Uint8Array([0xff, 0xfb, 0x90, 0x64]),
      new TextEncoder().encode('synthetic-mp3-frame-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('accepts the lowest MP3 raw frame-sync byte, 0xe0', () => {
    const plain = concat(
      new Uint8Array([0xff, 0xe0, 0x90, 0x64]),
      new TextEncoder().encode('synthetic-mp3-frame-body'),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    const decrypted = decryptRpgmv(encrypted, KEY_BYTES);

    expect(Array.from(decrypted)).toEqual(Array.from(plain));
  });

  it('rejects an MP3 frame-sync byte below 0xe0', () => {
    const plain = concat(
      new Uint8Array([0xff, 0xdf, 0x90, 0x64]),
      new TextEncoder().encode('synthetic-invalid-mp3-frame'),
    );

    expect(() => decryptRpgmv(encryptFixture(plain, KEY_BYTES), KEY_BYTES)).toThrowError(
      expect.objectContaining({ code: 'magic-mismatch' }),
    );
  });

  it('still throws DecryptError(magic-mismatch) for a RIFF chunk that is neither WEBP nor WAVE', () => {
    const plain = concat(
      new TextEncoder().encode('RIFF'),
      new Uint8Array([0x10, 0, 0, 0]),
      new TextEncoder().encode('AVI '), // a RIFF-family type we don't accept
      new Uint8Array(16),
    );
    const encrypted = encryptFixture(plain, KEY_BYTES);

    expect(() => decryptRpgmv(encrypted, KEY_BYTES)).toThrow(DecryptError);
    try {
      decryptRpgmv(encrypted, KEY_BYTES);
      expect.unreachable('expected decryptRpgmv to throw');
    } catch (err) {
      expect((err as DecryptError).code).toBe('magic-mismatch');
    }
  });

  it('rejects MP3 frame sync without the leading 0xff byte', () => {
    const plain = concat(new Uint8Array([0x7f, 0xe0, 0x90, 0x64]), new Uint8Array(12));

    expect(() => decryptRpgmv(encryptFixture(plain, KEY_BYTES), KEY_BYTES)).toThrowError(
      expect.objectContaining({ code: 'magic-mismatch' }),
    );
  });
});
