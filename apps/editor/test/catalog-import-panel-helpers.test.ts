import { describe, expect, it } from 'vitest';
import type { ImportSummary } from '../src/catalog-client.js';
import {
  buildImportSummaryMessage,
  importErrorLocaleKey,
  importUnitLocaleKey,
  isImportPathReady,
  trimImportPath,
} from '../src/catalog-import-panel-helpers.js';

const emptySummary = (): ImportSummary => ({
  gamesImported: 0,
  assetsStored: 0,
  assetsLinked: 0,
  tilesetsIngested: 0,
  sheetsLinked: 0,
  sheetsSkipped: 0,
  scanErrors: [],
  gameFailures: [],
});

describe('catalog-import-panel-helpers: path input', () => {
  it('trims leading and trailing whitespace', () => {
    expect(trimImportPath('  C:\\Games  ')).toBe('C:\\Games');
  });

  it('treats empty and whitespace-only as not ready', () => {
    expect(isImportPathReady('')).toBe(false);
    expect(isImportPathReady('   ')).toBe(false);
  });

  it('treats trimmed non-empty paths as ready', () => {
    expect(isImportPathReady('  /home/games  ')).toBe(true);
  });
});

describe('catalog-import-panel-helpers: import unit locale keys', () => {
  it('uses one for count 1 and other otherwise', () => {
    expect(importUnitLocaleKey('game', 1)).toBe('catalog.import.unit.game.one');
    expect(importUnitLocaleKey('game', 0)).toBe('catalog.import.unit.game.other');
    expect(importUnitLocaleKey('asset', 2)).toBe('catalog.import.unit.asset.other');
    expect(importUnitLocaleKey('tileset', 1)).toBe('catalog.import.unit.tileset.one');
  });
});

describe('catalog-import-panel-helpers: import error locale keys', () => {
  it('maps known error codes to catalog.import.error.* keys', () => {
    expect(importErrorLocaleKey('PathNotFound')).toBe('catalog.import.error.PathNotFound');
    expect(importErrorLocaleKey('PathNotDirectory')).toBe('catalog.import.error.PathNotDirectory');
    expect(importErrorLocaleKey('StoreFailed')).toBe('catalog.import.error.StoreFailed');
  });

  it('falls back to a generic key for unknown codes', () => {
    expect(importErrorLocaleKey('Unexpected')).toBe('catalog.import.error.generic');
    expect(importErrorLocaleKey('')).toBe('catalog.import.error.generic');
  });
});

describe('catalog-import-panel-helpers: import summary messages', () => {
  it('reports a clean success with counts from assetsLinked', () => {
    expect(
      buildImportSummaryMessage({
        ...emptySummary(),
        gamesImported: 2,
        assetsStored: 5,
        assetsLinked: 120,
        tilesetsIngested: 8,
      }),
    ).toEqual({
      variant: 'success',
      localeKey: 'catalog.import.success',
      values: { games: 2, assets: 120, tilesets: 8 },
    });
  });

  it('treats reimport with linked assets but no new blobs as success content', () => {
    expect(
      buildImportSummaryMessage({
        ...emptySummary(),
        gamesImported: 1,
        assetsStored: 0,
        assetsLinked: 42,
        tilesetsIngested: 3,
      }),
    ).toEqual({
      variant: 'success',
      localeKey: 'catalog.import.success',
      values: { games: 1, assets: 42, tilesets: 3 },
    });
  });

  it('reports partial success when some games failed', () => {
    expect(
      buildImportSummaryMessage({
        ...emptySummary(),
        gamesImported: 1,
        assetsStored: 10,
        assetsLinked: 40,
        tilesetsIngested: 3,
        gameFailures: [{ rootPath: '/bad', message: 'parse error' }],
      }),
    ).toEqual({
      variant: 'partial',
      localeKey: 'catalog.import.partial',
      values: { games: 1, assets: 40, tilesets: 3, gameFailures: 1, scanErrors: 0 },
    });
  });

  it('reports partial success when scan errors occurred', () => {
    expect(
      buildImportSummaryMessage({
        ...emptySummary(),
        gamesImported: 0,
        assetsStored: 0,
        assetsLinked: 5,
        tilesetsIngested: 0,
        scanErrors: [{ path: '/x', code: 'ReadFailed', message: 'denied' }],
      }),
    ).toEqual({
      variant: 'partial',
      localeKey: 'catalog.import.partial',
      values: { games: 0, assets: 5, tilesets: 0, gameFailures: 0, scanErrors: 1 },
    });
  });

  it('reports failures with no imports as partial, not empty', () => {
    expect(
      buildImportSummaryMessage({
        ...emptySummary(),
        gameFailures: [
          { rootPath: '/a', message: 'fail' },
          { rootPath: '/b', message: 'fail' },
        ],
      }),
    ).toEqual({
      variant: 'partial',
      localeKey: 'catalog.import.partial',
      values: { games: 0, assets: 0, tilesets: 0, gameFailures: 2, scanErrors: 0 },
    });
  });

  it('reports the nothing-found case when all counts are zero and there are no failures', () => {
    expect(buildImportSummaryMessage(emptySummary())).toEqual({
      variant: 'empty',
      localeKey: 'catalog.import.nothingFound',
      values: {},
    });
  });
});
