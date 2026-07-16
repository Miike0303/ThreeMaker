import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { openCatalog } from '../src/catalog.js';
import { resolveActorSheetFromCatalog } from '../src/resolve-actor-sheet.js';

describe('resolveActorSheetFromCatalog', () => {
  let workDir: string;
  let catalog: Catalog;
  let gameRoot: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-resolve-actor-sheet-test-'));
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

  it('resolves img/characters/<characterName>.png to its cataloged sha256', () => {
    const gameId = seedGame(gameRoot);
    catalog.insertObject({ sha256: 'sha-actor1', bytes: 10, kind: 'png' });
    catalog.upsertAsset({
      gameId,
      relPath: 'img/characters/Actor1.png',
      type: 'character',
      sha256: 'sha-actor1',
      wasEncrypted: false,
    });

    const ref = resolveActorSheetFromCatalog(catalog, gameRoot, 'Actor1', 3);

    expect(ref).toEqual({ object: 'sha-actor1', characterIndex: 3 });
  });

  it('matches the game directory case-insensitively', () => {
    const gameId = seedGame(gameRoot);
    catalog.insertObject({ sha256: 'sha-actor1', bytes: 10, kind: 'png' });
    catalog.upsertAsset({
      gameId,
      relPath: 'img/characters/Actor1.png',
      type: 'character',
      sha256: 'sha-actor1',
      wasEncrypted: false,
    });

    const ref = resolveActorSheetFromCatalog(catalog, gameRoot.toUpperCase(), 'actor1', 0);

    expect(ref).toEqual({ object: 'sha-actor1', characterIndex: 0 });
  });

  it('returns undefined (fail-soft) when the game directory is not cataloged', () => {
    const ref = resolveActorSheetFromCatalog(catalog, join(workDir, 'unknown-game'), 'Actor1', 0);
    expect(ref).toBeUndefined();
  });

  it('returns undefined (fail-soft) when the game is cataloged but the sheet is not', () => {
    seedGame(gameRoot);

    const ref = resolveActorSheetFromCatalog(catalog, gameRoot, 'Actor1', 0);

    expect(ref).toBeUndefined();
  });
});
