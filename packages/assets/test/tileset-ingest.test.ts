import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, GameRow } from '../src/catalog.js';
import { openCatalog } from '../src/catalog.js';
import { ingestTilesetsForGame } from '../src/tileset-ingest.js';

function makeTilesetsJson(): unknown {
  // Matches parseTilesets' expected shape: a 1-indexed sparse array with a
  // null placeholder at index 0, tilesetNames in [A1..A5,B,C,D,E] order.
  return [
    null,
    {
      id: 1,
      name: 'Outside',
      tilesetNames: ['', 'Outside_A2', '', '', '', 'Outside_B', '', '', ''],
      flags: new Array(8192).fill(0),
    },
  ];
}

describe('ingestTilesetsForGame', () => {
  let workDir: string;
  let catalog: Catalog;
  let gameRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-tileset-ingest-test-'));
    catalog = openCatalog(join(workDir, 'catalog.db'));
    gameRoot = join(workDir, 'game');
  });

  afterEach(() => {
    catalog.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function makeGameRow(engine: 'mv' | 'mz'): GameRow {
    const id = catalog.upsertGame({
      rootPath: gameRoot,
      title: 'Test Game',
      engine,
      encryptionKey: null,
      scannedAt: new Date().toISOString(),
    });
    return {
      id,
      rootPath: gameRoot,
      title: 'Test Game',
      engine,
      encryptionKey: null,
      scannedAt: new Date().toISOString(),
    };
  }

  function seedCatalogedAsset(gameId: number, relPath: string): void {
    const sha = `sha-${relPath}`;
    catalog.insertObject({ sha256: sha, bytes: 10, kind: 'png' });
    catalog.upsertAsset({ gameId, relPath, type: 'tileset', sha256: sha, wasEncrypted: false });
  }

  it('returns a zero-result summary when Tilesets.json is missing (never throws)', () => {
    const game = makeGameRow('mz');
    const result = ingestTilesetsForGame(catalog, game);
    expect(result).toEqual({ tilesetsProcessed: 0, sheetsLinked: 0, sheetsSkipped: 0 });
  });

  it('MZ: reads data/Tilesets.json, links sheets already cataloged, and skips ones that are not', () => {
    const game = makeGameRow('mz');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_A2.png');
    // Deliberately do NOT catalog Outside_B.png -- exercises the skip path.
    mkdirSync(join(gameRoot, 'data'), { recursive: true });
    writeFileSync(join(gameRoot, 'data', 'Tilesets.json'), JSON.stringify(makeTilesetsJson()));

    const result = ingestTilesetsForGame(catalog, game);

    expect(result).toEqual({ tilesetsProcessed: 1, sheetsLinked: 1, sheetsSkipped: 1 });
    const tilesets = catalog.listTilesetsForGame(game.id);
    expect(tilesets).toHaveLength(1);
    const full = catalog.getTileset(tilesets[0]?.id ?? -1);
    expect(full?.sheets).toEqual([
      {
        slot: 'A2',
        assetId: expect.any(Number),
        sha256: 'sha-img/tilesets/Outside_A2.png',
        relPath: 'img/tilesets/Outside_A2.png',
      },
    ]);
  });

  it('MV: reads www/data/Tilesets.json (nested under www/)', () => {
    const game = makeGameRow('mv');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_A2.png');
    mkdirSync(join(gameRoot, 'www', 'data'), { recursive: true });
    writeFileSync(
      join(gameRoot, 'www', 'data', 'Tilesets.json'),
      JSON.stringify(makeTilesetsJson()),
    );

    const result = ingestTilesetsForGame(catalog, game);

    expect(result.tilesetsProcessed).toBe(1);
    expect(result.sheetsLinked).toBe(1);
  });

  it('resolves an encrypted game whose cataloged asset ends in .png_ (or .rpgmvp), not plain .png', () => {
    const game = makeGameRow('mz');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_A2.png_');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_B.rpgmvp');
    mkdirSync(join(gameRoot, 'data'), { recursive: true });
    writeFileSync(join(gameRoot, 'data', 'Tilesets.json'), JSON.stringify(makeTilesetsJson()));

    const result = ingestTilesetsForGame(catalog, game);

    expect(result).toEqual({ tilesetsProcessed: 1, sheetsLinked: 2, sheetsSkipped: 0 });
    const tileset = catalog.getTileset(catalog.listTilesetsForGame(game.id)[0]?.id ?? -1);
    expect(tileset?.sheets.map((sheet) => sheet.relPath).sort()).toEqual([
      'img/tilesets/Outside_A2.png_',
      'img/tilesets/Outside_B.rpgmvp',
    ]);
  });

  it('reads a Tilesets.json prefixed with a UTF-8 BOM instead of throwing on JSON.parse', () => {
    const game = makeGameRow('mz');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_A2.png');
    mkdirSync(join(gameRoot, 'data'), { recursive: true });
    writeFileSync(
      join(gameRoot, 'data', 'Tilesets.json'),
      `﻿${JSON.stringify(makeTilesetsJson())}`,
      'utf8',
    );

    const result = ingestTilesetsForGame(catalog, game);

    expect(result).toEqual({ tilesetsProcessed: 1, sheetsLinked: 1, sheetsSkipped: 1 });
  });

  it('throws for a malformed Tilesets.json (real-world games ship these) -- callers must isolate this per game, same convention as ingestGame', () => {
    const game = makeGameRow('mz');
    mkdirSync(join(gameRoot, 'data'), { recursive: true });
    writeFileSync(
      join(gameRoot, 'data', 'Tilesets.json'),
      JSON.stringify([null, { id: 22, name: 'Broken', tilesetNames: [], flags: 'not-an-array' }]),
    );

    expect(() => ingestTilesetsForGame(catalog, game)).toThrow();
  });

  it('is idempotent: running twice does not duplicate tilesets or sheets', () => {
    const game = makeGameRow('mz');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_A2.png');
    seedCatalogedAsset(game.id, 'img/tilesets/Outside_B.png');
    mkdirSync(join(gameRoot, 'data'), { recursive: true });
    writeFileSync(join(gameRoot, 'data', 'Tilesets.json'), JSON.stringify(makeTilesetsJson()));

    ingestTilesetsForGame(catalog, game);
    ingestTilesetsForGame(catalog, game);

    expect(catalog.listTilesetsForGame(game.id)).toHaveLength(1);
    const tileset = catalog.getTileset(catalog.listTilesetsForGame(game.id)[0]?.id ?? -1);
    expect(tileset?.sheets).toHaveLength(2);
  });
});
