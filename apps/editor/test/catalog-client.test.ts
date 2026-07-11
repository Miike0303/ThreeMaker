import { describe, expect, it } from 'vitest';
import {
  buildDevAssetsUrl,
  buildDevGamesUrl,
  buildDevObjectUrl,
  KNOWN_ASSET_TYPES,
} from '../src/catalog-client.js';

describe('buildDevAssetsUrl', () => {
  it('omits absent filter fields', () => {
    expect(buildDevAssetsUrl({}, 0)).toBe('/api/dev-catalog/assets?page=0');
  });

  it('includes gameId and type when present', () => {
    expect(buildDevAssetsUrl({ gameId: 3, type: 'tileset' }, 2)).toBe(
      '/api/dev-catalog/assets?gameId=3&type=tileset&page=2',
    );
  });

  it('includes only gameId when type is absent', () => {
    expect(buildDevAssetsUrl({ gameId: 7 }, 0)).toBe('/api/dev-catalog/assets?gameId=7&page=0');
  });
});

describe('buildDevObjectUrl', () => {
  it('builds a kind-qualified object URL', () => {
    expect(buildDevObjectUrl('abc123', 'png')).toBe('/api/dev-catalog/object/abc123?kind=png');
  });
});

describe('buildDevGamesUrl', () => {
  it('has no query params', () => {
    expect(buildDevGamesUrl()).toBe('/api/dev-catalog/games');
  });
});

describe('KNOWN_ASSET_TYPES', () => {
  it('includes tileset and bgm (mirrors catalog.ts classification map)', () => {
    expect(KNOWN_ASSET_TYPES).toContain('tileset');
    expect(KNOWN_ASSET_TYPES).toContain('bgm');
    expect(KNOWN_ASSET_TYPES).toContain('other');
  });

  it('has no duplicate entries', () => {
    expect(new Set(KNOWN_ASSET_TYPES).size).toBe(KNOWN_ASSET_TYPES.length);
  });
});
