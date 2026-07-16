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
});
