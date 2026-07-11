import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, IngestGameResult } from '../src/catalog.js';
import { ingestGame, openCatalog, sumResults } from '../src/catalog.js';
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

  it('isolates a per-asset decrypt failure (missing key) without aborting the game ingest', () => {
    const gameRoot = join(workDir, 'Game');
    writeAsset(gameRoot, 'img', 'tilesets/Overworld.png', TINY_PNG); // will fail: flagged encrypted, no key
    writeAsset(gameRoot, 'img', 'system/Window.png', TINY_PNG); // also flagged, also fails
    const record = makeGame({
      rootPath: gameRoot,
      hasEncryptedImages: true,
      encryptionKey: null,
      imageAssets: ['tilesets/Overworld.png', 'system/Window.png'],
    });

    const result = ingestGame(catalog, record, { storeDir });

    expect(result.filesFailed).toBe(2);
    expect(catalog.listAssets({ gameId: result.gameId })).toHaveLength(0);
    const errors = catalog.listScanErrors({ gameId: result.gameId });
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.code === 'bad-key')).toBe(true);
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
