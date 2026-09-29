import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { openCatalog } from '../src/catalog.js';
import { resolveRpgmSlotsFromCatalog } from '../src/resolve-rpgm-slots.js';

describe('resolveRpgmSlotsFromCatalog', () => {
  let workDir: string;
  let catalog: Catalog;
  let gameRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-resolve-rpgm-slots-test-'));
    catalog = openCatalog(join(workDir, 'catalog.db'));
    gameRoot = join(workDir, 'game');
  });

  afterEach(() => {
    catalog.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function seedGame(rootPath: string): number {
    return catalog.upsertGame({
      rootPath,
      title: 'Test Game',
      engine: 'mz',
      encryptionKey: null,
      scannedAt: new Date().toISOString(),
    });
  }

  function seedSheet(gameId: number, tilesetId: number, slot: 'A1' | 'A2' | 'B', relPath: string) {
    const sha256 = `sha-${relPath}`;
    catalog.insertObject({ sha256, bytes: 10, kind: 'png' });
    catalog.upsertAsset({
      gameId,
      relPath,
      type: 'tileset',
      sha256,
      wasEncrypted: false,
    });
    const asset = catalog.getAssetByRelPath(gameId, relPath);
    if (!asset) throw new Error('test setup: asset not found after upsert');
    catalog.upsertTilesetSheet({ tilesetId, slot, assetId: asset.id });
    return sha256;
  }

  function seedA1Sheet() {
    const gameId = seedGame(gameRoot);
    const tilesetId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: JSON.stringify(new Array(8192).fill(0)),
    });
    const shaA1 = seedSheet(gameId, tilesetId, 'A1', 'img/tilesets/Outside_A1.png');
    return { gameId, tilesetId, shaA1 };
  }

  it('resolves every cataloged sheet slot into a SlotComposition keyed by sha256', () => {
    const gameId = seedGame(gameRoot);
    const tilesetId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: JSON.stringify(new Array(8192).fill(0)),
    });
    const shaA2 = seedSheet(gameId, tilesetId, 'A2', 'img/tilesets/Outside_A2.png');
    const shaB = seedSheet(gameId, tilesetId, 'B', 'img/tilesets/Outside_B.png');

    const slots = resolveRpgmSlotsFromCatalog(catalog, gameRoot, 1);

    expect(slots).toEqual({
      A2: { object: shaA2, sourceTilesetId: tilesetId, sourceGameId: gameId },
      B: { object: shaB, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('matches the game directory case-insensitively (Windows filesystems are case-insensitive)', () => {
    const { gameId, tilesetId, shaA1 } = seedA1Sheet();

    const slots = resolveRpgmSlotsFromCatalog(catalog, gameRoot.toUpperCase(), 1);

    expect(slots).toEqual({
      A1: { object: shaA1, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('matches a cataloged game when given its data directory', () => {
    const { gameId, tilesetId, shaA1 } = seedA1Sheet();

    const slots = resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'data'), 1);

    expect(slots).toEqual({
      A1: { object: shaA1, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('matches a cataloged game when given its www/data directory', () => {
    const { gameId, tilesetId, shaA1 } = seedA1Sheet();

    const slots = resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'www', 'data'), 1);

    expect(slots).toEqual({
      A1: { object: shaA1, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('returns {} (fail-soft) when the game directory is not cataloged at all', () => {
    const slots = resolveRpgmSlotsFromCatalog(catalog, join(workDir, 'unknown-game'), 1);
    expect(slots).toEqual({});
  });

  it('returns {} (fail-soft) when the game is cataloged but the rpgm tileset id has no match', () => {
    const gameId = seedGame(gameRoot);
    catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: JSON.stringify(new Array(8192).fill(0)),
    });

    const slots = resolveRpgmSlotsFromCatalog(catalog, gameRoot, 999);

    expect(slots).toEqual({});
  });

  it('does not resolve a different tileset with a larger RPG Maker id', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, gameRoot, 0)).toEqual({});
  });

  it('does not substitute a lower RPG Maker tileset ID', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, gameRoot, 2)).toEqual({});
  });

  it('preserves the game ID when it differs from the tileset ID', () => {
    seedGame(join(workDir, 'unrelated-game'));
    const { gameId, tilesetId, shaA1 } = seedA1Sheet();
    expect(gameId).not.toBe(tilesetId);

    expect(resolveRpgmSlotsFromCatalog(catalog, gameRoot, 1)).toEqual({
      A1: { object: shaA1, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('prefers the nearest cataloged root for www/data', () => {
    seedA1Sheet();
    const nestedRoot = join(gameRoot, 'www');
    const gameId = seedGame(nestedRoot);
    const tilesetId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Nested',
      flags: JSON.stringify(new Array(8192).fill(0)),
    });
    const shaA1 = seedSheet(gameId, tilesetId, 'A1', 'img/tilesets/Nested_A1.png');

    expect(resolveRpgmSlotsFromCatalog(catalog, join(nestedRoot, 'data'), 1)).toEqual({
      A1: { object: shaA1, sourceTilesetId: tilesetId, sourceGameId: gameId },
    });
  });

  it('does not treat a database directory as a data directory', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'database'), 1)).toEqual({});
  });

  it('does not treat metadata as a data directory', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'metadata'), 1)).toEqual({});
  });

  it('does not resolve a grandparent game through a non-www data directory', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'backup', 'data'), 1)).toEqual({});
  });

  it('does not treat www/database as the deployed MV data directory', () => {
    seedA1Sheet();

    expect(resolveRpgmSlotsFromCatalog(catalog, join(gameRoot, 'www', 'database'), 1)).toEqual({});
  });

  it('returns empty slots when a listed tileset record is no longer available', () => {
    const { tilesetId } = seedA1Sheet();
    const lookup = vi.spyOn(catalog, 'getTileset').mockReturnValueOnce(null);
    try {
      expect(resolveRpgmSlotsFromCatalog(catalog, gameRoot, 1)).toEqual({});
      expect(lookup).toHaveBeenCalledWith(tilesetId);
    } finally {
      lookup.mockRestore();
    }
  });
});
