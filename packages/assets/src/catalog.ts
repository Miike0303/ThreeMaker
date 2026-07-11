import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DecryptError, decryptRpgmv } from './decrypt.js';
import { storeObject } from './object-store.js';
import type { GameRecord } from './scanner.js';

/**
 * SQLite catalog: a rebuildable index over source games, derived entirely
 * from scanning + decrypting + hashing. Schema matches the design's DDL
 * exactly (no extra tables/columns) — `tilesets`/`tileset_sheets`/
 * `tile_semantics` are created here so the catalog is schema-complete from
 * day one, even though Slice 2 does not populate them yet (that's Slice 3/4
 * territory: tileset composition + semantic editing).
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  title TEXT,
  engine TEXT NOT NULL CHECK (engine IN ('mv','mz')),
  encryption_key TEXT,
  scanned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('png','ogg','m4a','other')),
  width INTEGER,
  height INTEGER
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  rel_path TEXT NOT NULL,
  type TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES objects(sha256),
  was_encrypted INTEGER NOT NULL,
  UNIQUE(game_id, rel_path)
);

CREATE TABLE IF NOT EXISTS tilesets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  rpgm_id INTEGER,
  name TEXT,
  flags TEXT
);

CREATE TABLE IF NOT EXISTS tileset_sheets (
  tileset_id INTEGER NOT NULL REFERENCES tilesets(id),
  slot TEXT NOT NULL CHECK (slot IN ('A1','A2','A3','A4','A5','B','C','D','E')),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  PRIMARY KEY (tileset_id, slot)
);

CREATE TABLE IF NOT EXISTS tile_semantics (
  tileset_id INTEGER NOT NULL REFERENCES tilesets(id),
  tile_id INTEGER NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('wall','door','window','furniture','none')),
  ext TEXT,
  PRIMARY KEY (tileset_id, tile_id)
);

CREATE TABLE IF NOT EXISTS scan_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id),
  rel_path TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_objects_kind ON objects(kind);
`;

export interface GameRow {
  readonly id: number;
  readonly rootPath: string;
  readonly title: string | null;
  readonly engine: 'mv' | 'mz';
  readonly encryptionKey: string | null;
  readonly scannedAt: string;
}

export interface AssetRow {
  readonly id: number;
  readonly gameId: number;
  readonly relPath: string;
  readonly type: string;
  readonly sha256: string;
  readonly wasEncrypted: boolean;
}

export interface ScanErrorRow {
  readonly id: number;
  readonly gameId: number | null;
  readonly relPath: string | null;
  readonly code: string;
  readonly message: string;
}

export interface AssetFilter {
  readonly gameId?: number;
  readonly type?: string;
}

export interface ScanErrorFilter {
  readonly gameId?: number;
}

export interface DedupeStats {
  readonly assetCount: number;
  readonly distinctObjectCount: number;
}

export interface UpsertGameInput {
  readonly rootPath: string;
  readonly title: string | null;
  readonly engine: 'mv' | 'mz';
  readonly encryptionKey: string | null;
  readonly scannedAt: string;
}

export interface InsertObjectInput {
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: 'png' | 'ogg' | 'm4a' | 'other';
}

export interface UpsertAssetInput {
  readonly gameId: number;
  readonly relPath: string;
  readonly type: string;
  readonly sha256: string;
  readonly wasEncrypted: boolean;
}

export interface InsertScanErrorInput {
  readonly gameId: number | null;
  readonly relPath: string | null;
  readonly code: string;
  readonly message: string;
}

interface GameRowRaw {
  id: number;
  root_path: string;
  title: string | null;
  engine: 'mv' | 'mz';
  encryption_key: string | null;
  scanned_at: string;
}

interface AssetRowRaw {
  id: number;
  game_id: number;
  rel_path: string;
  type: string;
  sha256: string;
  was_encrypted: number;
}

interface ScanErrorRowRaw {
  id: number;
  game_id: number | null;
  rel_path: string | null;
  code: string;
  message: string;
}

/** Read-write handle on a catalog database. Rebuildable from source games. */
export class Catalog {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // WAL mode lets the editor (Slice 3, read-only via Tauri IPC) read
    // concurrently with the CLI writing a bulk-run. `busy_timeout` makes a
    // writer/reader collision retry for a bit instead of failing immediately
    // with SQLITE_BUSY, which matters once both sides are real concurrent
    // processes rather than the single-process usage this slice exercises.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /** Introspection helper for schema tests — real SQLite table names, not a hardcoded list. */
  listTableNames(): string[] {
    const rows = this.db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all();
    return rows.map((row) => row.name);
  }

  /** Introspection helper for concurrency tests — reads a pragma's current value. */
  getPragma(name: string): unknown {
    return this.db.pragma(name, { simple: true });
  }

  /** Insert-or-update by `root_path` (unique) — re-scanning a game updates it, never duplicates it. */
  upsertGame(input: UpsertGameInput): number {
    const row = this.db
      .prepare<[string, string | null, string, string | null, string], { id: number }>(
        `INSERT INTO games (root_path, title, engine, encryption_key, scanned_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(root_path) DO UPDATE SET
           title = excluded.title,
           engine = excluded.engine,
           encryption_key = excluded.encryption_key,
           scanned_at = excluded.scanned_at
         RETURNING id`,
      )
      .get(input.rootPath, input.title, input.engine, input.encryptionKey, input.scannedAt);
    if (!row) throw new Error(`upsertGame: RETURNING id produced no row for "${input.rootPath}"`);
    return row.id;
  }

  /** Insert-or-ignore by `sha256` (primary key) — the same object is only ever stored once. */
  insertObject(input: InsertObjectInput): void {
    this.db
      .prepare(
        `INSERT INTO objects (sha256, bytes, kind) VALUES (?, ?, ?)
         ON CONFLICT(sha256) DO NOTHING`,
      )
      .run(input.sha256, input.bytes, input.kind);
  }

  /** Insert-or-update by `(game_id, rel_path)` (unique) — idempotent re-ingest. */
  upsertAsset(input: UpsertAssetInput): void {
    this.db
      .prepare(
        `INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(game_id, rel_path) DO UPDATE SET
           type = excluded.type,
           sha256 = excluded.sha256,
           was_encrypted = excluded.was_encrypted`,
      )
      .run(input.gameId, input.relPath, input.type, input.sha256, input.wasEncrypted ? 1 : 0);
  }

  insertScanError(input: InsertScanErrorInput): void {
    this.db
      .prepare(`INSERT INTO scan_errors (game_id, rel_path, code, message) VALUES (?, ?, ?, ?)`)
      .run(input.gameId, input.relPath, input.code, input.message);
  }

  listGames(): GameRow[] {
    const rows = this.db
      .prepare<[], GameRowRaw>(
        `SELECT id, root_path, title, engine, encryption_key, scanned_at FROM games ORDER BY root_path`,
      )
      .all();
    return rows.map(mapGameRow);
  }

  listAssets(filter: AssetFilter = {}): AssetRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.gameId !== undefined) {
      clauses.push('game_id = ?');
      params.push(filter.gameId);
    }
    if (filter.type !== undefined) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare<(string | number)[], AssetRowRaw>(
        `SELECT id, game_id, rel_path, type, sha256, was_encrypted FROM assets ${where} ORDER BY rel_path`,
      )
      .all(...params);
    return rows.map(mapAssetRow);
  }

  listScanErrors(filter: ScanErrorFilter = {}): ScanErrorRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.gameId !== undefined) {
      clauses.push('game_id = ?');
      params.push(filter.gameId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare<(string | number)[], ScanErrorRowRaw>(
        `SELECT id, game_id, rel_path, code, message FROM scan_errors ${where} ORDER BY id`,
      )
      .all(...params);
    return rows.map(mapScanErrorRow);
  }

  /** `count(assets)` vs `count(DISTINCT sha256)` — the design's dedupe stat, optionally scoped to one game. */
  getDedupeStats(filter: { gameId?: number } = {}): DedupeStats {
    const where = filter.gameId !== undefined ? 'WHERE game_id = ?' : '';
    const params = filter.gameId !== undefined ? [filter.gameId] : [];
    const row = this.db
      .prepare<(string | number)[], { assetCount: number; distinctObjectCount: number }>(
        `SELECT COUNT(*) as assetCount, COUNT(DISTINCT sha256) as distinctObjectCount FROM assets ${where}`,
      )
      .get(...params);
    // COUNT(*) with no GROUP BY always yields exactly one row, even over zero matches.
    return row ?? { assetCount: 0, distinctObjectCount: 0 };
  }
}

export function openCatalog(dbPath: string): Catalog {
  return new Catalog(dbPath);
}

function mapGameRow(row: GameRowRaw): GameRow {
  return {
    id: row.id,
    rootPath: row.root_path,
    title: row.title,
    engine: row.engine,
    encryptionKey: row.encryption_key,
    scannedAt: row.scanned_at,
  };
}

function mapAssetRow(row: AssetRowRaw): AssetRow {
  return {
    id: row.id,
    gameId: row.game_id,
    relPath: row.rel_path,
    type: row.type,
    sha256: row.sha256,
    wasEncrypted: row.was_encrypted === 1,
  };
}

function mapScanErrorRow(row: ScanErrorRowRaw): ScanErrorRow {
  return {
    id: row.id,
    gameId: row.game_id,
    relPath: row.rel_path,
    code: row.code,
    message: row.message,
  };
}

// --- Ingestion pipeline -----------------------------------------------

/** RPG Maker's per-slot image folder names mapped to a catalog `type`. */
const IMAGE_TYPE_MAP: Readonly<Record<string, string>> = {
  tilesets: 'tileset',
  parallaxes: 'parallax',
  pictures: 'picture',
  characters: 'character',
  faces: 'face',
  enemies: 'enemy',
  sv_actors: 'sv_actor',
  sv_enemies: 'sv_enemy',
  animations: 'animation',
  battlebacks1: 'battleback1',
  battlebacks2: 'battleback2',
  titles1: 'title1',
  titles2: 'title2',
  system: 'system',
};

/** RPG Maker's audio folder names mapped to a catalog `type`. */
const AUDIO_TYPE_MAP: Readonly<Record<string, string>> = {
  bgm: 'bgm',
  bgs: 'bgs',
  me: 'me',
  se: 'se',
};

/**
 * Classifies an asset's catalog `type` from its RPG Maker folder convention.
 * `type` has no CHECK constraint in the schema (see design's "Additive entry
 * types" decision) — unrecognized/future kinds (e.g. glTF, HD variants) fall
 * back to `'other'` and are still fully cataloged and queryable, just not
 * specially labeled yet.
 */
function classifyAssetType(kind: 'image' | 'audio', relPath: string): string {
  const firstSegment = relPath.split('/')[0]?.toLowerCase();
  if (!firstSegment) return 'other';
  const map = kind === 'image' ? IMAGE_TYPE_MAP : AUDIO_TYPE_MAP;
  return map[firstSegment] ?? 'other';
}

/** Classifies an object's storage `kind` (images are always PNG in RPG Maker MV/MZ). */
function classifyObjectKind(kind: 'image' | 'audio', relPath: string): InsertObjectInput['kind'] {
  if (kind === 'image') return 'png';
  const ext = extname(relPath).toLowerCase();
  if (ext === '.ogg' || ext === '.rpgmvo' || ext === '.ogg_') return 'ogg';
  if (ext === '.m4a' || ext === '.m4a_') return 'm4a';
  return 'other';
}

/** RPG Maker MV nests assets under `www/`; MZ does not. */
function assetRootFor(game: GameRecord): string {
  return game.engine === 'mv' ? join(game.rootPath, 'www') : game.rootPath;
}

export interface IngestGameOptions {
  readonly storeDir: string;
}

export interface IngestGameResult {
  readonly gameId: number;
  readonly filesSeen: number;
  readonly filesFailed: number;
  readonly objectsCreated: number;
  readonly bytesScanned: number;
  readonly bytesStored: number;
}

export interface AggregateIngestStats {
  readonly filesSeen: number;
  readonly filesFailed: number;
  readonly objectsCreated: number;
  readonly bytesScanned: number;
  readonly bytesStored: number;
}

/**
 * Sums the numeric fields of `IngestGameResult` across many games. Extracted
 * so callers (the bulk-run CLI) don't hand-roll the same five-field
 * accumulator inline — a single reducer used once beats five separate
 * `total += result.field` lines repeated per caller.
 */
export function sumResults(results: readonly IngestGameResult[]): AggregateIngestStats {
  return results.reduce<AggregateIngestStats>(
    (acc, result) => ({
      filesSeen: acc.filesSeen + result.filesSeen,
      filesFailed: acc.filesFailed + result.filesFailed,
      objectsCreated: acc.objectsCreated + result.objectsCreated,
      bytesScanned: acc.bytesScanned + result.bytesScanned,
      bytesStored: acc.bytesStored + result.bytesStored,
    }),
    { filesSeen: 0, filesFailed: 0, objectsCreated: 0, bytesScanned: 0, bytesStored: 0 },
  );
}

/**
 * Ingests one scanned game into the catalog: decrypts (per
 * `hasEncryptedImages`/`hasEncryptedAudio`, NOT per file extension — a
 * game's flag is authoritative for every asset of that kind), hashes,
 * stores content-addressed bytes, and links catalog rows. Never throws for
 * a single bad asset — failures are recorded as `scan_errors` rows and the
 * rest of the game's assets still get ingested (per-game error isolation
 * extends to per-asset isolation within a game).
 */
export function ingestGame(
  catalog: Catalog,
  game: GameRecord,
  options: IngestGameOptions,
): IngestGameResult {
  const gameId = catalog.upsertGame({
    rootPath: game.rootPath,
    title: basenameOf(game.rootPath),
    engine: game.engine,
    encryptionKey: game.encryptionKey ? bytesToHex(game.encryptionKey) : null,
    scannedAt: new Date().toISOString(),
  });

  const assetRoot = assetRootFor(game);
  let filesSeen = 0;
  let filesFailed = 0;
  let objectsCreated = 0;
  let bytesScanned = 0;
  let bytesStored = 0;

  const ingestOne = (kind: 'image' | 'audio', relPath: string, dirName: 'img' | 'audio') => {
    filesSeen++;
    const fullPath = join(assetRoot, dirName, ...relPath.split('/'));
    const catalogRelPath = `${dirName}/${relPath}`;

    let raw: Uint8Array;
    try {
      raw = readFileSync(fullPath);
    } catch (err) {
      filesFailed++;
      catalog.insertScanError({
        gameId,
        relPath: catalogRelPath,
        code: 'read-error',
        message: describeError(err),
      });
      return;
    }
    bytesScanned += raw.length;

    const needsDecrypt = kind === 'image' ? game.hasEncryptedImages : game.hasEncryptedAudio;
    let decoded: Uint8Array;
    if (needsDecrypt) {
      if (!game.encryptionKey) {
        filesFailed++;
        catalog.insertScanError({
          gameId,
          relPath: catalogRelPath,
          code: 'bad-key',
          message: `Game reports encrypted ${kind} assets but has no usable encryption key.`,
        });
        return;
      }
      try {
        decoded = decryptRpgmv(raw, game.encryptionKey);
      } catch (err) {
        filesFailed++;
        const code = err instanceof DecryptError ? err.code : 'read-error';
        catalog.insertScanError({
          gameId,
          relPath: catalogRelPath,
          code,
          message: describeError(err),
        });
        return;
      }
    } else {
      decoded = raw;
    }

    // `storeObject` already hashes `decoded` internally to compute the
    // content-addressed path — reuse `stored.sha256` instead of hashing the
    // same bytes a second time here. At bulk-run scale (hundreds of
    // thousands of assets) that redundant hash pass is real time, not style.
    const stored = storeObject(options.storeDir, decoded);
    if (stored.created) {
      objectsCreated++;
      bytesStored += decoded.length;
    }

    catalog.insertObject({
      sha256: stored.sha256,
      bytes: decoded.length,
      kind: classifyObjectKind(kind, relPath),
    });
    catalog.upsertAsset({
      gameId,
      relPath: catalogRelPath,
      type: classifyAssetType(kind, relPath),
      sha256: stored.sha256,
      wasEncrypted: needsDecrypt,
    });
  };

  for (const relPath of game.imageAssets) ingestOne('image', relPath, 'img');
  for (const relPath of game.audioAssets) ingestOne('audio', relPath, 'audio');

  return { gameId, filesSeen, filesFailed, objectsCreated, bytesScanned, bytesStored };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
