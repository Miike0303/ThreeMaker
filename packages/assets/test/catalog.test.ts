import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, IngestGameResult } from '../src/catalog.js';
import { ingestGame, openCatalog, SCHEMA_VERSION, sumResults } from '../src/catalog.js';
import type { GameRecord } from '../src/scanner.js';

// A tiny valid PNG (1x1 transparent pixel) used as "decrypted" content in
// these tests — we exercise the catalog pipeline with already-plain bytes
// (hasEncryptedImages/hasEncryptedAudio: false) since decrypt.ts's own
// round-trip is already covered by decrypt.test.ts / decrypt.real.test.ts.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const TINY_OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);

function makeGame(overrides: Partial<GameRecord> & { rootPath: string }): GameRecord {
  return {
    engine: 'mz',
    hasEncryptedImages: false,
    hasEncryptedAudio: false,
    encryptionKey: null,
    imageAssets: [],
    audioAssets: [],
    ...overrides,
  };
}

describe('catalog', () => {
  let workDir: string;
  let storeDir: string;
  let catalog: Catalog;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-catalog-test-'));
    storeDir = join(workDir, 'store');
    catalog = openCatalog(join(workDir, 'catalog.db'));
  });

  afterEach(() => {
    catalog.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeAsset(gameRoot: string, kind: 'img' | 'audio', relPath: string, bytes: Uint8Array) {
    const segments = relPath.split('/');
    const fileName = segments.pop() ?? relPath;
    const dir = join(gameRoot, kind, ...segments);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), bytes);
  }

  it('creates the full schema (games/objects/assets/tilesets/tileset_sheets/tile_semantics/scan_errors)', () => {
    const tableNames = catalog.listTableNames();
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'games',
        'objects',
        'assets',
        'tilesets',
        'tileset_sheets',
        'tile_semantics',
        'scan_errors',
      ]),
    );
  });

  it('opens in WAL journal mode with a busy timeout, for safe concurrent read (editor) + write (CLI) access', () => {
    expect(catalog.getPragma('journal_mode')).toBe('wal');
    expect(Number(catalog.getPragma('busy_timeout'))).toBeGreaterThan(0);
  });

  it('stamps the schema version via PRAGMA user_version, so readers (Rust IPC, dev fallback) can detect drift', () => {
    expect(Number(catalog.getPragma('user_version'))).toBe(SCHEMA_VERSION);
  });

  it('dedupes identical decrypted content across two games into 1 object + 2 references', () => {
    const gameA = join(workDir, 'en', 'Game');
    const gameB = join(workDir, 'es', 'Game');
    writeAsset(gameA, 'img', 'tilesets/Overworld.png', TINY_PNG);
    writeAsset(gameB, 'img', 'tilesets/Overworld.png', TINY_PNG);

    const recordA = makeGame({ rootPath: gameA, imageAssets: ['tilesets/Overworld.png'] });
    const recordB = makeGame({ rootPath: gameB, imageAssets: ['tilesets/Overworld.png'] });

    ingestGame(catalog, recordA, { storeDir });
    ingestGame(catalog, recordB, { storeDir });

    const stats = catalog.getDedupeStats();
    expect(stats.assetCount).toBe(2);
    expect(stats.distinctObjectCount).toBe(1);
  });

  it('supports query by game and by type', () => {
    const gameRoot = join(workDir, 'Game');
    writeAsset(gameRoot, 'img', 'tilesets/Overworld.png', TINY_PNG);
    writeAsset(gameRoot, 'audio', 'bgm/Battle.ogg', TINY_OGG);

    const record = makeGame({
      rootPath: gameRoot,
      imageAssets: ['tilesets/Overworld.png'],
      audioAssets: ['bgm/Battle.ogg'],
    });
    const { gameId } = ingestGame(catalog, record, { storeDir });

    const games = catalog.listGames();
    expect(games).toHaveLength(1);
    expect(games[0]?.rootPath).toBe(gameRoot);

    const tilesetAssets = catalog.listAssets({ gameId, type: 'tileset' });
    expect(tilesetAssets).toHaveLength(1);
    expect(tilesetAssets[0]?.relPath).toBe('img/tilesets/Overworld.png');

    const bgmAssets = catalog.listAssets({ gameId, type: 'bgm' });
    expect(bgmAssets).toHaveLength(1);
    expect(bgmAssets[0]?.relPath).toBe('audio/bgm/Battle.ogg');

    const allAssets = catalog.listAssets({ gameId });
    expect(allAssets).toHaveLength(2);
  });

  it('supports SQL-level LIMIT/OFFSET pagination without loading the full result set', () => {
    const gameRoot = join(workDir, 'Game');
    // 5 distinct tileset assets, sorted by rel_path: A, B, C, D, E.
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      writeAsset(gameRoot, 'img', `tilesets/${letter}.png`, TINY_PNG);
    }
    const record = makeGame({
      rootPath: gameRoot,
      imageAssets: ['A', 'B', 'C', 'D', 'E'].map((letter) => `tilesets/${letter}.png`),
    });
    ingestGame(catalog, record, { storeDir });

    const firstPage = catalog.listAssets({ type: 'tileset' }, { page: 0, pageSize: 2 });
    expect(firstPage.map((a) => a.relPath)).toEqual(['img/tilesets/A.png', 'img/tilesets/B.png']);

    const secondPage = catalog.listAssets({ type: 'tileset' }, { page: 1, pageSize: 2 });
    expect(secondPage.map((a) => a.relPath)).toEqual(['img/tilesets/C.png', 'img/tilesets/D.png']);

    const lastPartialPage = catalog.listAssets({ type: 'tileset' }, { page: 2, pageSize: 2 });
    expect(lastPartialPage.map((a) => a.relPath)).toEqual(['img/tilesets/E.png']);

    // No pagination argument -- unchanged, unpaginated behavior (existing callers unaffected).
    expect(catalog.listAssets({ type: 'tileset' })).toHaveLength(5);

    expect(catalog.countAssets({ type: 'tileset' })).toBe(5);
    expect(catalog.countAssets({ type: 'bgm' })).toBe(0);
  });

  it('catalogs a non-rendered additive type (parallax) as queryable metadata', () => {
    const gameRoot = join(workDir, 'Game');
    writeAsset(gameRoot, 'img', 'parallaxes/Clouds.png', TINY_PNG);

    const record = makeGame({ rootPath: gameRoot, imageAssets: ['parallaxes/Clouds.png'] });
    ingestGame(catalog, record, { storeDir });

    const parallaxAssets = catalog.listAssets({ type: 'parallax' });
    expect(parallaxAssets).toHaveLength(1);
    expect(parallaxAssets[0]?.relPath).toBe('img/parallaxes/Clouds.png');
  });

  it('re-ingesting the same game updates rows instead of duplicating them', () => {
    const gameRoot = join(workDir, 'Game');
    writeAsset(gameRoot, 'img', 'tilesets/Overworld.png', TINY_PNG);
    const record = makeGame({ rootPath: gameRoot, imageAssets: ['tilesets/Overworld.png'] });

    const first = ingestGame(catalog, record, { storeDir });
    const second = ingestGame(catalog, record, { storeDir });

    expect(second.gameId).toBe(first.gameId);
    expect(catalog.listGames()).toHaveLength(1);
    expect(catalog.listAssets({ gameId: first.gameId })).toHaveLength(1);
  });

  it('getMaxScanErrorId returns 0 for an empty scan_errors table, and rises monotonically after inserts', () => {
    expect(catalog.getMaxScanErrorId()).toBe(0);

    catalog.insertScanError({ gameId: null, relPath: 'a', code: 'read-error', message: 'x' });
    const afterFirst = catalog.getMaxScanErrorId();
    expect(afterFirst).toBeGreaterThan(0);

    catalog.insertScanError({ gameId: null, relPath: 'b', code: 'read-error', message: 'y' });
    const afterSecond = catalog.getMaxScanErrorId();
    expect(afterSecond).toBeGreaterThan(afterFirst);

    // Matches the highest id actually present in listScanErrors().
    const errors = catalog.listScanErrors();
    expect(afterSecond).toBe(Math.max(...errors.map((e) => e.id)));
  });

  it('isolates a per-asset decrypt failure (missing key) without aborting the game ingest', () => {
    const gameRoot = join(workDir, 'Game');
    // .png_ / .rpgmvp are always-encrypted extensions -- they need a key
    // regardless of the game's flag, so a missing key fails them per-asset.
    writeAsset(gameRoot, 'img', 'tilesets/Overworld.png_', TINY_PNG); // will fail: encrypted extension, no key
    writeAsset(gameRoot, 'img', 'system/Window.rpgmvp', TINY_PNG); // also encrypted extension, also fails
    const record = makeGame({
      rootPath: gameRoot,
      hasEncryptedImages: true,
      encryptionKey: null,
      imageAssets: ['tilesets/Overworld.png_', 'system/Window.rpgmvp'],
    });

    const result = ingestGame(catalog, record, { storeDir });

    expect(result.filesFailed).toBe(2);
    expect(catalog.listAssets({ gameId: result.gameId })).toHaveLength(0);
    const errors = catalog.listScanErrors({ gameId: result.gameId });
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.code === 'bad-key')).toBe(true);
  });

  it('passes through a plain .png asset untouched even when the game is flagged hasEncryptedImages (per-file decision, not per-game flag)', () => {
    const gameRoot = join(workDir, 'Game');
    // Real deployed MV/MZ games always ship some plain assets alongside
    // encrypted ones (e.g. img/system/Loading.png is never encrypted by the
    // official deployer) -- the game-level flag must not force-decrypt them.
    writeAsset(gameRoot, 'img', 'system/Loading.png', TINY_PNG);

    const key = new Uint8Array(16).fill(0x11);
    const header = new Uint8Array([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const plain = new Uint8Array(32).fill(0);
    plain.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG magic
    const encryptedChunk = plain.slice(0, 16).map((b, i) => b ^ (key[i] ?? 0));
    const rest = plain.slice(16);
    const encrypted = new Uint8Array([...header, ...encryptedChunk, ...rest]);
    writeAsset(gameRoot, 'img', 'tilesets/Overworld.png_', encrypted);

    const record = makeGame({
      rootPath: gameRoot,
      hasEncryptedImages: true,
      encryptionKey: key,
      imageAssets: ['system/Loading.png', 'tilesets/Overworld.png_'],
    });

    const result = ingestGame(catalog, record, { storeDir });

    expect(result.filesFailed).toBe(0);
    const assets = catalog.listAssets({ gameId: result.gameId });
    expect(assets).toHaveLength(2);
    const loading = assets.find((a) => a.relPath === 'img/system/Loading.png');
    expect(loading?.wasEncrypted).toBe(false);
    const overworld = assets.find((a) => a.relPath === 'img/tilesets/Overworld.png_');
    expect(overworld?.wasEncrypted).toBe(true);
  });

  it('audio assets are decrypted through the same pipeline when hasEncryptedAudio is set', () => {
    const gameRoot = join(workDir, 'Game');
    // Build a real encrypted-audio fixture: fake header + XOR'd first 16 bytes.
    const key = new Uint8Array(16).fill(0x11);
    const header = new Uint8Array([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const plain = new Uint8Array(32).fill(0);
    plain.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    const encryptedChunk = plain.slice(0, 16).map((b, i) => b ^ (key[i] ?? 0));
    const rest = plain.slice(16);
    const encrypted = new Uint8Array([...header, ...encryptedChunk, ...rest]);

    writeAsset(gameRoot, 'audio', 'bgm/Battle.ogg_', encrypted);

    const record = makeGame({
      rootPath: gameRoot,
      hasEncryptedAudio: true,
      encryptionKey: key,
      audioAssets: ['bgm/Battle.ogg_'],
    });

    const result = ingestGame(catalog, record, { storeDir });

    expect(result.filesFailed).toBe(0);
    const assets = catalog.listAssets({ gameId: result.gameId, type: 'bgm' });
    expect(assets).toHaveLength(1);
    expect(assets[0]?.wasEncrypted).toBe(true);
  });
});

describe('catalog tileset composition (getAssetByRelPath / upsertTileset / upsertTilesetSheet / getTileset)', () => {
  let workDir: string;
  let catalog: Catalog;
  let gameId: number;
  let assetId: number;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-catalog-tileset-test-'));
    catalog = openCatalog(join(workDir, 'catalog.db'));
    gameId = catalog.upsertGame({
      rootPath: join(workDir, 'game'),
      title: 'Test Game',
      engine: 'mz',
      encryptionKey: null,
      scannedAt: new Date().toISOString(),
    });
    catalog.insertObject({ sha256: 'sha-outside-a2', bytes: 100, kind: 'png' });
    catalog.upsertAsset({
      gameId,
      relPath: 'img/tilesets/Outside_A2.png',
      type: 'tileset',
      sha256: 'sha-outside-a2',
      wasEncrypted: false,
    });
    const asset = catalog.getAssetByRelPath(gameId, 'img/tilesets/Outside_A2.png');
    if (!asset) throw new Error('unreachable: asset was just upserted');
    assetId = asset.id;
  });

  afterEach(() => {
    catalog.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('getAssetByRelPath returns null for an unknown rel_path', () => {
    expect(catalog.getAssetByRelPath(gameId, 'img/tilesets/Nope.png')).toBeNull();
  });

  it('getAssetByRelPath resolves case-insensitively (RPG Maker filesystems are case-insensitive)', () => {
    const asset = catalog.getAssetByRelPath(gameId, 'IMG/TILESETS/outside_a2.PNG');
    expect(asset?.id).toBe(assetId);
  });

  it('upsertTileset inserts a new row and getTileset returns it with no sheets yet', () => {
    const tilesetId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: '[0,16]',
    });

    const tileset = catalog.getTileset(tilesetId);
    expect(tileset).toEqual({
      id: tilesetId,
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: '[0,16]',
      sheets: [],
    });
  });

  it('upsertTileset re-run with the same (gameId, rpgmId) updates in place, not duplicates', () => {
    const firstId = catalog.upsertTileset({ gameId, rpgmId: 1, name: 'Outside', flags: '[0]' });
    const secondId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside Renamed',
      flags: '[0,1]',
    });

    expect(secondId).toBe(firstId);
    expect(catalog.getTileset(firstId)?.name).toBe('Outside Renamed');
    expect(catalog.listTilesetsForGame(gameId)).toHaveLength(1);
  });

  it('upsertTilesetSheet links a slot to an asset, resolvable via getTileset', () => {
    const tilesetId = catalog.upsertTileset({ gameId, rpgmId: 1, name: 'Outside', flags: '[0]' });
    catalog.upsertTilesetSheet({ tilesetId, slot: 'A2', assetId });

    const tileset = catalog.getTileset(tilesetId);
    expect(tileset?.sheets).toEqual([
      { slot: 'A2', assetId, sha256: 'sha-outside-a2', relPath: 'img/tilesets/Outside_A2.png' },
    ]);
  });

  it('upsertTilesetSheet re-run for the same (tilesetId, slot) replaces the asset, not duplicates the row', () => {
    catalog.insertObject({ sha256: 'sha-outside-a2-v2', bytes: 100, kind: 'png' });
    catalog.upsertAsset({
      gameId,
      relPath: 'img/tilesets/Outside_A2_v2.png',
      type: 'tileset',
      sha256: 'sha-outside-a2-v2',
      wasEncrypted: false,
    });
    const secondAsset = catalog.getAssetByRelPath(gameId, 'img/tilesets/Outside_A2_v2.png');
    if (!secondAsset) throw new Error('unreachable');

    const tilesetId = catalog.upsertTileset({ gameId, rpgmId: 1, name: 'Outside', flags: '[0]' });
    catalog.upsertTilesetSheet({ tilesetId, slot: 'A2', assetId });
    catalog.upsertTilesetSheet({ tilesetId, slot: 'A2', assetId: secondAsset.id });

    const tileset = catalog.getTileset(tilesetId);
    expect(tileset?.sheets).toHaveLength(1);
    expect(tileset?.sheets[0]?.assetId).toBe(secondAsset.id);
  });

  it('getTileset returns null for an unknown id', () => {
    expect(catalog.getTileset(999)).toBeNull();
  });

  it('listTilesetsForGame scopes to the given game only', () => {
    const otherGameId = catalog.upsertGame({
      rootPath: join(workDir, 'other-game'),
      title: 'Other Game',
      engine: 'mv',
      encryptionKey: null,
      scannedAt: new Date().toISOString(),
    });
    catalog.upsertTileset({ gameId, rpgmId: 1, name: 'Mine', flags: '[0]' });
    catalog.upsertTileset({ gameId: otherGameId, rpgmId: 1, name: 'Theirs', flags: '[0]' });

    const mine = catalog.listTilesetsForGame(gameId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe('Mine');
  });
});

describe('sumResults', () => {
  it('sums ingest results across games, field by field', () => {
    const results: IngestGameResult[] = [
      {
        gameId: 1,
        filesSeen: 10,
        filesFailed: 1,
        objectsCreated: 5,
        bytesScanned: 100,
        bytesStored: 50,
      },
      {
        gameId: 2,
        filesSeen: 20,
        filesFailed: 2,
        objectsCreated: 15,
        bytesScanned: 200,
        bytesStored: 150,
      },
    ];

    expect(sumResults(results)).toEqual({
      filesSeen: 30,
      filesFailed: 3,
      objectsCreated: 20,
      bytesScanned: 300,
      bytesStored: 200,
    });
  });

  it('returns all zeros for an empty list', () => {
    expect(sumResults([])).toEqual({
      filesSeen: 0,
      filesFailed: 0,
      objectsCreated: 0,
      bytesScanned: 0,
      bytesStored: 0,
    });
  });
});
