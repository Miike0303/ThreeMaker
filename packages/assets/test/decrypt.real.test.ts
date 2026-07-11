import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decryptRpgmv, parseEncryptionKey } from '../src/decrypt.js';

// Byte-verified round-trip against a REAL installed RPG Maker MV/MZ game.
// `D:\juegos\rpgm` is a local, machine-specific game library — NOT a repo
// fixture (see fixtures/README.md for the repo-fixture pattern used
// elsewhere). No bytes from it are ever read into this repo; this test only
// reads the file at test-run time on machines where the path exists. It
// skips (does not fail) when the path is unavailable, e.g. CI or another
// contributor's machine.
const SYSTEM_JSON_PATH = 'D:/juegos/rpgm/en/Branded to Fall/data/System.json';
const ENCRYPTED_FILE_PATH = 'D:/juegos/rpgm/en/Branded to Fall/img/battlebacks1/Clouds.png_';
const REAL_GAME_AVAILABLE = existsSync(SYSTEM_JSON_PATH) && existsSync(ENCRYPTED_FILE_PATH);

describe.skipIf(!REAL_GAME_AVAILABLE)('decryptRpgmv against a real installed game', () => {
  it('decrypts a real .png_ battleback asset to a byte-verified PNG', () => {
    const system = JSON.parse(readFileSync(SYSTEM_JSON_PATH, 'utf8')) as Record<string, unknown>;
    expect(system.hasEncryptedImages).toBe(true);

    const key = parseEncryptionKey(system);
    expect(key).not.toBeNull();

    const encrypted = new Uint8Array(readFileSync(ENCRYPTED_FILE_PATH));
    const decrypted = decryptRpgmv(encrypted, key as Uint8Array);

    // Real PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(decrypted.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
