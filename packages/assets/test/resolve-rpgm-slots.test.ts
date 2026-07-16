import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    const gameId = seedGame(gameRoot);
    const tilesetId = catalog.upsertTileset({
      gameId,
      rpgmId: 1,
      name: 'Outside',
      flags: JSON.stringify(new Array(8192).fill(0)),
    });
    const shaA1 = seedSheet(gameId, tilesetId, 'A1', 'img/tilesets/Outside_A1.png');

    const slots = resolveRpgmSlotsFromCatalog(catalog, gameRoot.toUpperCase(), 1);

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
});
