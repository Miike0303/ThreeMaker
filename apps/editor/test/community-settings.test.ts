import { describe, expect, it } from 'vitest';
import {
  clearCommunityShareQueue,
  COMMUNITY_SHARE_QUEUE_MAX,
  DEFAULT_COMMUNITY_SETTINGS,
  describeCommunityShareStatus,
  communityShareTileCount,
  formatCommunityShareAt,
  formatCommunityShareMapId,
  loadCommunitySettings,
  loadCommunityShareQueue,
  maybeEnqueueCommunityShare,
  parseCommunityShareQueueJson,
  pushCommunityShareQueue,
  removeCommunityShareQueueJob,
  replaceCommunityShareQueue,
  saveCommunitySettings,
  serializeCommunityShareQueue,
  licenseTagFromSlots,
  usesOnlyImportedSlotSources,
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
  version: 6,
  licenseTag: 'user-owned',
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
      version: 6,
      licenseTag: 'user-owned' as const,
      now: () => '2026-08-08T00:00:00.000Z',
    };
    expect(
      maybeEnqueueCommunityShare({ shareOnSave: true, allowImportedAssets: false }, base),
    ).toEqual({
      mapId: 'm1',
      mapName: 'Demo',
      tileObjectShas: ['a'.repeat(64)],
      at: '2026-08-08T00:00:00.000Z',
      version: 6,
      licenseTag: 'user-owned',
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
        { ...base, usesOnlyImportedAssets: true, licenseTag: 'import-rpgm' },
      ),
    ).toEqual({
      mapId: 'm1',
      mapName: 'Demo',
      tileObjectShas: ['a'.repeat(64)],
      at: '2026-08-08T00:00:00.000Z',
      version: 6,
      licenseTag: 'import-rpgm',
    });
  });
});

describe('formatCommunityShareAt (WU-COMM-09)', () => {
  it('formats a valid ISO timestamp with the given locale', () => {
    const formatted = formatCommunityShareAt('2026-08-08T14:30:00.000Z', 'en-US');
    // Locale shapes vary by ICU data; assert it is not the raw ISO string and parses.
    expect(formatted).not.toBe('2026-08-08T14:30:00.000Z');
    expect(formatted.length).toBeGreaterThan(0);
    expect(Date.parse('2026-08-08T14:30:00.000Z')).toBeGreaterThan(0);
    // en-US medium-ish: includes year 2026 and a time separator or AM/PM.
    expect(formatted).toMatch(/2026/);
  });

  it('returns the original string when the value is not a date', () => {
    expect(formatCommunityShareAt('not-a-date')).toBe('not-a-date');
    expect(formatCommunityShareAt('')).toBe('');
  });
});

describe('communityShareTileCount (WU-COMM-10)', () => {
  it('counts unique non-empty shas only', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(communityShareTileCount([])).toBe(0);
    expect(communityShareTileCount(['', a, a, b, ''])).toBe(2);
    expect(communityShareTileCount([a])).toBe(1);
  });
});

describe('formatCommunityShareMapId (WU-COMM-11)', () => {
  it('returns short ids unchanged and trims whitespace', () => {
    expect(formatCommunityShareMapId('abc')).toBe('abc');
    expect(formatCommunityShareMapId('  map-1  ')).toBe('map-1');
    expect(formatCommunityShareMapId('12345678')).toBe('12345678');
  });

  it('truncates long ids to the first maxLen chars (default 8)', () => {
    expect(formatCommunityShareMapId('0123456789abcdef')).toBe('01234567');
    expect(formatCommunityShareMapId('0123456789abcdef', 4)).toBe('0123');
    expect(formatCommunityShareMapId('uuid-with-hyphens-long', 12)).toBe('uuid-with-hy');
  });

  it('returns empty string for blank input', () => {
    expect(formatCommunityShareMapId('')).toBe('');
    expect(formatCommunityShareMapId('   ')).toBe('');
  });
});

describe('usesOnlyImportedSlotSources (WU-COMM-06)', () => {
  const SHA = 'a'.repeat(64);

  it('is false for empty maps and object-only (user) slots', () => {
    expect(usesOnlyImportedSlotSources({})).toBe(false);
    expect(usesOnlyImportedSlotSources({ A: {} })).toBe(false);
    expect(usesOnlyImportedSlotSources({ A: { object: SHA } })).toBe(false);
  });

  it('is true when every filled slot has catalog provenance ids', () => {
    expect(
      usesOnlyImportedSlotSources({
        A: { object: SHA, sourceGameId: 1, sourceTilesetId: 10 },
        B: { object: 'b'.repeat(64), sourceTilesetId: 11 },
        C: {},
      }),
    ).toBe(true);
  });

  it('is false when any filled slot lacks provenance (mixed catalog + user)', () => {
    expect(
      usesOnlyImportedSlotSources({
        A: { object: SHA, sourceGameId: 1 },
        B: { object: 'b'.repeat(64) },
      }),
    ).toBe(false);
  });
});

describe('licenseTagFromSlots (WU-COMM-07)', () => {
  const SHA = 'a'.repeat(64);

  it('classifies empty, user-owned, import-rpgm, and mixed', () => {
    expect(licenseTagFromSlots({})).toBe('user-owned');
    expect(licenseTagFromSlots({ A: { object: SHA } })).toBe('user-owned');
    expect(
      licenseTagFromSlots({ A: { object: SHA, sourceGameId: 1 } }),
    ).toBe('import-rpgm');
    expect(
      licenseTagFromSlots({
        A: { object: SHA, sourceGameId: 1 },
        B: { object: 'b'.repeat(64) },
      }),
    ).toBe('mixed');
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

  it('push replaces prior job with the same mapId (WU-COMM-05)', () => {
    const storage = memoryStorage();
    pushCommunityShareQueue(sampleJob('a', '2026-08-08T00:00:00.000Z'), storage);
    pushCommunityShareQueue(sampleJob('b', '2026-08-08T01:00:00.000Z'), storage);
    const next = pushCommunityShareQueue(
      { ...sampleJob('a', '2026-08-08T02:00:00.000Z'), mapName: 'Map a v2' },
      storage,
    );
    expect(next.map((j) => `${j.mapId}:${j.at}:${j.mapName}`)).toEqual([
      'a:2026-08-08T02:00:00.000Z:Map a v2',
      'b:2026-08-08T01:00:00.000Z:Map b',
    ]);
    expect(loadCommunityShareQueue(storage)).toHaveLength(2);
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
    const b = sampleJob('b', '2026-08-08T01:00:00.000Z');
    const c = sampleJob('c', '2026-08-08T02:00:00.000Z');
    pushCommunityShareQueue(a, storage);
    pushCommunityShareQueue(b, storage);
    pushCommunityShareQueue(c, storage);
    // newest first: c, b, a (one job per mapId)
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['c', 'b', 'a']);
    const after = removeCommunityShareQueueJob('b', b.at, storage);
    expect(after.map((j) => `${j.mapId}:${j.at}`)).toEqual([
      `c:${c.at}`,
      `a:${a.at}`,
    ]);
    expect(removeCommunityShareQueueJob('missing', a.at, storage)).toEqual(after);
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['c', 'a']);
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

  it('load/parse normalizes legacy jobs missing version and licenseTag', () => {
    const legacy = {
      mapId: 'legacy',
      mapName: 'Old',
      tileObjectShas: ['a'.repeat(64)],
      at: '2026-08-08T00:00:00.000Z',
    };
    const storage = memoryStorage({
      'threemaker-maker-studio:community-queue': JSON.stringify([legacy]),
    });
    expect(loadCommunityShareQueue(storage)).toEqual([
      { ...legacy, version: 0, licenseTag: 'user-owned' },
    ]);
    expect(parseCommunityShareQueueJson(JSON.stringify([legacy]))).toEqual({
      ok: true,
      jobs: [{ ...legacy, version: 0, licenseTag: 'user-owned' }],
    });
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
