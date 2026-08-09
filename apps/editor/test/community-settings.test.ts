import { describe, expect, it } from 'vitest';
import {
  clearCommunityShareQueue,
  COMMUNITY_SHARE_QUEUE_MAX,
  DEFAULT_COMMUNITY_SETTINGS,
  describeCommunityShareStatus,
  loadCommunitySettings,
  loadCommunityShareQueue,
  maybeEnqueueCommunityShare,
  parseCommunityShareQueueJson,
  pushCommunityShareQueue,
  removeCommunityShareQueueJob,
  replaceCommunityShareQueue,
  saveCommunitySettings,
  serializeCommunityShareQueue,
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

  it('clearCommunityShareQueue empties storage and returns []', () => {
    const storage = memoryStorage();
    pushCommunityShareQueue(sampleJob('a'), storage);
    pushCommunityShareQueue(sampleJob('b'), storage);
    expect(loadCommunityShareQueue(storage)).toHaveLength(2);
    expect(clearCommunityShareQueue(storage)).toEqual([]);
    expect(loadCommunityShareQueue(storage)).toEqual([]);
  });

  it('removeCommunityShareQueueJob drops matching mapId+at only', () => {
    const storage = memoryStorage();
    const a = sampleJob('a', '2026-08-08T00:00:00.000Z');
    const a2 = sampleJob('a', '2026-08-08T02:00:00.000Z');
    const b = sampleJob('b', '2026-08-08T01:00:00.000Z');
    pushCommunityShareQueue(a, storage);
    pushCommunityShareQueue(b, storage);
    pushCommunityShareQueue(a2, storage);
    // newest first: a2, b, a
    expect(loadCommunityShareQueue(storage).map((j) => j.at)).toEqual([
      a2.at,
      b.at,
      a.at,
    ]);
    const after = removeCommunityShareQueueJob('a', a2.at, storage);
    expect(after.map((j) => `${j.mapId}:${j.at}`)).toEqual([
      `b:${b.at}`,
      `a:${a.at}`,
    ]);
    expect(removeCommunityShareQueueJob('missing', a.at, storage)).toEqual(after);
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['b', 'a']);
  });

  it('serializeCommunityShareQueue is pretty JSON of the queue', () => {
    const jobs = [sampleJob('z'), sampleJob('y')];
    const raw = serializeCommunityShareQueue(jobs);
    expect(JSON.parse(raw)).toEqual(jobs);
    expect(raw).toContain('\n');
  });

  it('parseCommunityShareQueueJson accepts export and rejects bad input', () => {
    const jobs = [sampleJob('z'), sampleJob('y')];
    expect(parseCommunityShareQueueJson(serializeCommunityShareQueue(jobs))).toEqual({
      ok: true,
      jobs,
    });
    expect(parseCommunityShareQueueJson('not-json')).toEqual({
      ok: false,
      reason: 'invalid-json',
    });
    expect(parseCommunityShareQueueJson('{"mapId":"x"}')).toEqual({
      ok: false,
      reason: 'not-array',
    });
    expect(parseCommunityShareQueueJson('[{"mapId":1}]')).toEqual({
      ok: false,
      reason: 'no-valid-jobs',
    });
    // Strips invalid entries, keeps valid ones
    expect(
      parseCommunityShareQueueJson(
        JSON.stringify([sampleJob('ok'), { mapId: 1 }, sampleJob('two')]),
      ),
    ).toEqual({ ok: true, jobs: [sampleJob('ok'), sampleJob('two')] });
  });

  it('replaceCommunityShareQueue overwrites storage with filtered jobs', () => {
    const storage = memoryStorage();
    pushCommunityShareQueue(sampleJob('old'), storage);
    const next = replaceCommunityShareQueue(
      [sampleJob('a'), sampleJob('b'), { mapId: 1 } as unknown as CommunityShareEnqueue],
      storage,
    );
    expect(next.map((j) => j.mapId)).toEqual(['a', 'b']);
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['a', 'b']);
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
