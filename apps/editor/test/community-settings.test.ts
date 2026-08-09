import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_SHARE_QUEUE_MAX,
  DEFAULT_COMMUNITY_SETTINGS,
  describeCommunityShareStatus,
  loadCommunitySettings,
  loadCommunityShareQueue,
  maybeEnqueueCommunityShare,
  pushCommunityShareQueue,
  saveCommunitySettings,
  type CommunityShareEnqueue,
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

const sampleJob = (id: string, at = '2026-08-08T00:00:00.000Z'): CommunityShareEnqueue => ({
  mapId: id,
  mapName: `Map ${id}`,
  tileObjectShas: ['a'.repeat(64)],
  at,
});

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

describe('community share offline queue', () => {
  it('starts empty and push prepends newest first', () => {
    const storage = memoryStorage();
    expect(loadCommunityShareQueue(storage)).toEqual([]);
    const q1 = pushCommunityShareQueue(sampleJob('a'), storage);
    expect(q1).toEqual([sampleJob('a')]);
    const q2 = pushCommunityShareQueue(sampleJob('b', '2026-08-08T01:00:00.000Z'), storage);
    expect(q2.map((j) => j.mapId)).toEqual(['b', 'a']);
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['b', 'a']);
  });

  it(`caps queue at ${COMMUNITY_SHARE_QUEUE_MAX} entries`, () => {
    const storage = memoryStorage();
    for (let i = 0; i < COMMUNITY_SHARE_QUEUE_MAX + 5; i++) {
      pushCommunityShareQueue(sampleJob(String(i)), storage);
    }
    const queue = loadCommunityShareQueue(storage);
    expect(queue).toHaveLength(COMMUNITY_SHARE_QUEUE_MAX);
    expect(queue[0]?.mapId).toBe(String(COMMUNITY_SHARE_QUEUE_MAX + 4));
  });

  it('ignores corrupt queue storage', () => {
    const storage = memoryStorage({ 'threemaker-maker-studio:community-queue': 'not-json' });
    expect(loadCommunityShareQueue(storage)).toEqual([]);
  });
});

describe('describeCommunityShareStatus', () => {
  it('reports off when shareOnSave is false', () => {
    expect(
      describeCommunityShareStatus(
        { shareOnSave: false, allowImportedAssets: false },
        [sampleJob('a')],
      ),
    ).toEqual({ kind: 'off', queueLength: 1, lastMapName: 'Map a' });
  });

  it('reports ready when on and queue empty', () => {
    expect(describeCommunityShareStatus(DEFAULT_COMMUNITY_SETTINGS, [])).toEqual({
      kind: 'ready',
      queueLength: 0,
    });
  });

  it('reports queued with last map when on and queue non-empty', () => {
    expect(
      describeCommunityShareStatus(DEFAULT_COMMUNITY_SETTINGS, [
        sampleJob('z'),
        sampleJob('y'),
      ]),
    ).toEqual({ kind: 'queued', queueLength: 2, lastMapName: 'Map z' });
  });
});
