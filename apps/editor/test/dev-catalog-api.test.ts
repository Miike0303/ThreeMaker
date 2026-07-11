import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DevCatalogReader,
  EXPECTED_SCHEMA_VERSION,
  isValidSha256,
  SchemaVersionMismatchError,
} from '../dev-server/catalog-api.js';

// Minimal schema shape (games/objects/assets only) -- these tests only
// exercise DevCatalogReader's own methods, not the full catalog schema.
const MINIMAL_SCHEMA_SQL = `
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  title TEXT,
  engine TEXT NOT NULL,
  encryption_key TEXT,
  scanned_at TEXT NOT NULL
);
CREATE TABLE objects (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  was_encrypted INTEGER NOT NULL
);
`;

function buildFixtureDb(dbPath: string, schemaVersion: number): void {
  const db = new Database(dbPath);
  db.exec(MINIMAL_SCHEMA_SQL);
  db.pragma(`user_version = ${schemaVersion}`);
  db.close();
}

describe('isValidSha256', () => {
  it('accepts a 64-char lowercase hex digest', () => {
    expect(isValidSha256('a'.repeat(64))).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidSha256('a'.repeat(63))).toBe(false);
    expect(isValidSha256('a'.repeat(65))).toBe(false);
  });

  it('rejects uppercase or non-hex characters', () => {
    expect(isValidSha256('A'.repeat(64))).toBe(false);
    expect(isValidSha256(`${'a'.repeat(63)}z`)).toBe(false);
  });

  it('rejects path traversal / injection attempts', () => {
    expect(isValidSha256('../../etc/passwd')).toBe(false);
    expect(isValidSha256(`${'a'.repeat(60)}/../`)).toBe(false);
  });
});

describe('DevCatalogReader', () => {
  let workDir: string;
  let dbPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-dev-catalog-test-'));
    dbPath = join(workDir, 'catalog.db');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('opens successfully when the schema version matches', () => {
    buildFixtureDb(dbPath, EXPECTED_SCHEMA_VERSION);
    const reader = new DevCatalogReader(dbPath);
    expect(reader.listGames()).toEqual([]);
    reader.close();
  });

  it('throws SchemaVersionMismatchError (fails loudly) for a mismatched version', () => {
    buildFixtureDb(dbPath, 999);
    expect(() => new DevCatalogReader(dbPath)).toThrow(SchemaVersionMismatchError);
    expect(() => new DevCatalogReader(dbPath)).toThrow(/expected 1, found 999/);
  });

  it('paginates listAssets with SQL-level LIMIT/OFFSET and reports the true count via countAssets', () => {
    buildFixtureDb(dbPath, EXPECTED_SCHEMA_VERSION);
    const writer = new Database(dbPath);
    writer
      .prepare(`INSERT INTO games (root_path, engine, scanned_at) VALUES (?, 'mz', 'now')`)
      .run('/game');
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      const sha = letter.repeat(64).toLowerCase();
      writer.prepare(`INSERT INTO objects (sha256, bytes, kind) VALUES (?, 1, 'png')`).run(sha);
      writer
        .prepare(
          `INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted) VALUES (1, ?, 'tileset', ?, 0)`,
        )
        .run(`img/tilesets/${letter}.png`, sha);
    }
    writer.close();

    const reader = new DevCatalogReader(dbPath);
    expect(reader.countAssets({ type: 'tileset' })).toBe(5);

    const firstPage = reader.listAssets({ type: 'tileset' }, { page: 0, pageSize: 2 });
    expect(firstPage.map((a) => a.relPath)).toEqual(['img/tilesets/A.png', 'img/tilesets/B.png']);

    const secondPage = reader.listAssets({ type: 'tileset' }, { page: 1, pageSize: 2 });
    expect(secondPage.map((a) => a.relPath)).toEqual(['img/tilesets/C.png', 'img/tilesets/D.png']);

    reader.close();
  });

  it('objectPath throws for an invalid sha256 instead of joining it into a filesystem path', () => {
    buildFixtureDb(dbPath, EXPECTED_SCHEMA_VERSION);
    const reader = new DevCatalogReader(dbPath);
    expect(() => reader.objectPath('/store', '../../etc/passwd')).toThrow(
      /Invalid sha256 path segment/,
    );
    reader.close();
  });
});
