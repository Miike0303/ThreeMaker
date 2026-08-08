import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMUNITY_SETTINGS,
  loadCommunitySettings,
  maybeEnqueueCommunityShare,
  saveCommunitySettings,
} from '../src/community-settings.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('community-settings', () => {
  it('defaults to share-on-save true and imported assets false', () => {
    expect(DEFAULT_COMMUNITY_SETTINGS).toEqual({
      shareOnSave: true,
      allowImportedAssets: false,
    });
    expect(loadCommunitySettings(memoryStorage())).toEqual(DEFAULT_COMMUNITY_SETTINGS);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveCommunitySettings({ shareOnSave: false, allowImportedAssets: true }, storage);
    expect(loadCommunitySettings(storage)).toEqual({
      shareOnSave: false,
      allowImportedAssets: true,
    });
  });

  it('maybeEnqueue respects opt-out and imported-asset gate', () => {
    const base = {
      mapId: 'm1',
      mapName: 'Demo',
      tileObjectShas: ['a'.repeat(64)],
      usesOnlyImportedAssets: false,
      now: () => '2026-08-08T00:00:00.000Z',
    };
    expect(
      maybeEnqueueCommunityShare({ shareOnSave: true, allowImportedAssets: false }, base),
    ).toEqual({
      mapId: 'm1',
      mapName: 'Demo',
      tileObjectShas: ['a'.repeat(64)],
      at: '2026-08-08T00:00:00.000Z',
    });
    expect(
      maybeEnqueueCommunityShare({ shareOnSave: false, allowImportedAssets: false }, base),
    ).toBeNull();
    expect(
      maybeEnqueueCommunityShare(
        { shareOnSave: true, allowImportedAssets: false },
        { ...base, usesOnlyImportedAssets: true },
      ),
    ).toBeNull();
    expect(
      maybeEnqueueCommunityShare(
        { shareOnSave: true, allowImportedAssets: true },
        { ...base, usesOnlyImportedAssets: true },
      ),
    ).not.toBeNull();
  });
});
