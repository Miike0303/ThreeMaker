import { describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_SHARE_QUEUE_MAX,
  type CommunityShareEnqueue,
  clearCommunityShareQueue,
  communityShareQueueLicenseCounts,
  communityShareQueueTileTotal,
  communityShareTileCount,
  DEFAULT_COMMUNITY_SETTINGS,
  describeCommunityShareStatus,
  formatCommunityShareAt,
  formatCommunityShareMapId,
  licenseTagFromSlots,
  loadCommunitySettings,
  loadCommunityShareQueue,
  maybeEnqueueCommunityShare,
  parseCommunityShareQueueJson,
  pushCommunityShareQueue,
  removeCommunityShareQueueJob,
  replaceCommunityShareQueue,
  saveCommunitySettings,
  serializeCommunityShareQueue,
  usesOnlyImportedSlotSources,
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
  it('loads default preferences when stored community JSON is malformed', () => {
    const storage = memoryStorage({ 'threemaker-maker-studio:community': '{' });
    expect(loadCommunitySettings(storage)).toEqual({
      shareOnSave: true,
      allowImportedAssets: false,
    });
  });

  it('infers imported provenance when an allowed imported share omits its license tag', () => {
    const job = maybeEnqueueCommunityShare(
      { shareOnSave: true, allowImportedAssets: true },
      {
        mapId: 'imported-map',
        mapName: 'Imported map',
        tileObjectShas: ['a'.repeat(64)],
        usesOnlyImportedAssets: true,
        now: () => '2026-09-28T00:00:00.000Z',
      },
    );
    expect(job?.licenseTag).toBe('import-rpgm');
  });

  it('defaults a missing share-on-save preference to enabled', () => {
    const storage = memoryStorage({
      'threemaker-maker-studio:community': JSON.stringify({ allowImportedAssets: true }),
    });
    expect(loadCommunitySettings(storage)).toEqual({
      shareOnSave: true,
      allowImportedAssets: true,
    });
  });

  it('ignores an empty slot when classifying imported sheet provenance', () => {
    expect(
      licenseTagFromSlots({
        A: null,
        B: { object: 'a'.repeat(64), sourceGameId: 1 },
      }),
    ).toBe('import-rpgm');
  });

  it('ignores catalog provenance on a slot with an empty object hash', () => {
    expect(licenseTagFromSlots({ A: { object: '', sourceGameId: 1 } })).toBe('user-owned');
  });

  it('truncates a fractional map version in a queued share payload', () => {
    expect(
      maybeEnqueueCommunityShare(DEFAULT_COMMUNITY_SETTINGS, {
        mapId: 'map-1',
        mapName: 'Map',
        tileObjectShas: [],
        usesOnlyImportedAssets: false,
        version: 2.9,
        now: () => '2026-08-08T00:00:00.000Z',
      })?.version,
    ).toBe(2);
  });

  it('truncates a negative fractional map version toward zero when enqueuing', () => {
    expect(
      maybeEnqueueCommunityShare(DEFAULT_COMMUNITY_SETTINGS, {
        mapId: 'map-1',
        mapName: 'Map',
        tileObjectShas: [],
        usesOnlyImportedAssets: false,
        version: -1.9,
      })?.version,
    ).toBe(-1);
  });

  it('defaults a non-finite share payload version to zero', () => {
    expect(
      maybeEnqueueCommunityShare(DEFAULT_COMMUNITY_SETTINGS, {
        mapId: 'map-1',
        mapName: 'Map',
        tileObjectShas: [],
        usesOnlyImportedAssets: false,
        version: Number.POSITIVE_INFINITY,
      })?.version,
    ).toBe(0);
  });

  it('defaults to share-on-save true and imported assets false', () => {
    expect(DEFAULT_COMMUNITY_SETTINGS).toEqual({
      shareOnSave: true,
      allowImportedAssets: false,
    });
    expect(loadCommunitySettings(memoryStorage())).toEqual(DEFAULT_COMMUNITY_SETTINGS);
  });

  it('defaults imported assets to false when an older record omits the setting', () => {
    const storage = memoryStorage({
      'threemaker-maker-studio:community': JSON.stringify({ shareOnSave: true }),
    });
    expect(loadCommunitySettings(storage)).toEqual({
      shareOnSave: true,
      allowImportedAssets: false,
    });
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
  it('abbreviates the month in a localized queue timestamp', () => {
    const at = new Date(2026, 8, 28, 13, 5).toISOString();
    expect(formatCommunityShareAt(at, 'en-US')).toMatch(/^Sep 28, 2026, /);
  });

  it('keeps the timestamp when the requested locale is invalid', () => {
    const at = '2026-08-08T00:00:00.000Z';
    expect(formatCommunityShareAt(at, 'invalid_locale')).toBe(at);
  });

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
  it('uses the default map id prefix length when a custom limit is negative', () => {
    expect(formatCommunityShareMapId('0123456789abcdef', -1)).toBe('01234567');
  });

  it('honors a one-character map id prefix limit', () => {
    expect(formatCommunityShareMapId('town-square', 1)).toBe('t');
  });

  it('truncates a fractional prefix limit instead of rounding it', () => {
    expect(formatCommunityShareMapId('0123456789', 2.9)).toBe('01');
  });

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

  it('uses the default prefix length when a custom limit is zero', () => {
    expect(formatCommunityShareMapId('0123456789abcdef', 0)).toBe('01234567');
  });
});

describe('communityShareQueueTileTotal (WU-COMM-12)', () => {
  it('returns 0 for empty queue and blank-only shas', () => {
    expect(communityShareQueueTileTotal([])).toBe(0);
    expect(communityShareQueueTileTotal([{ ...sampleJob('a'), tileObjectShas: ['', ''] }])).toBe(0);
  });

  it('unions unique non-empty shas across jobs (no per-job sum)', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);
    expect(
      communityShareQueueTileTotal([
        { ...sampleJob('1'), tileObjectShas: [a, b, a, ''] },
        { ...sampleJob('2'), tileObjectShas: [b, c] },
        { ...sampleJob('3'), tileObjectShas: [c, a] },
      ]),
    ).toBe(3);
    expect(communityShareQueueTileTotal([{ ...sampleJob('solo'), tileObjectShas: [a] }])).toBe(1);
  });
});

describe('communityShareQueueLicenseCounts (WU-COMM-13)', () => {
  it('returns empty for an empty queue', () => {
    expect(communityShareQueueLicenseCounts([])).toEqual([]);
  });

  it('counts per license tag in canonical order, omitting zero tags', () => {
    expect(
      communityShareQueueLicenseCounts([
        { ...sampleJob('1'), licenseTag: 'mixed' },
        { ...sampleJob('2'), licenseTag: 'user-owned' },
        { ...sampleJob('3'), licenseTag: 'user-owned' },
      ]),
    ).toEqual([
      { tag: 'user-owned', count: 2 },
      { tag: 'mixed', count: 1 },
    ]);
  });

  it('keeps a single-tag queue to one entry', () => {
    expect(
      communityShareQueueLicenseCounts([{ ...sampleJob('1'), licenseTag: 'import-rpgm' }]),
    ).toEqual([{ tag: 'import-rpgm', count: 1 }]);
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
  it('does not classify a non-finite tileset id as imported provenance', () => {
    expect(
      licenseTagFromSlots({
        A5: { object: 'a'.repeat(64), sourceTilesetId: Number.POSITIVE_INFINITY },
      }),
    ).toBe('user-owned');
  });

  it('does not classify a non-finite game id as imported provenance', () => {
    expect(
      licenseTagFromSlots({
        A5: { object: 'a'.repeat(64), sourceGameId: Number.POSITIVE_INFINITY },
      }),
    ).toBe('user-owned');
  });

  const SHA = 'a'.repeat(64);

  it('classifies empty, user-owned, import-rpgm, and mixed', () => {
    expect(licenseTagFromSlots({})).toBe('user-owned');
    expect(licenseTagFromSlots({ A: { object: SHA } })).toBe('user-owned');
    expect(licenseTagFromSlots({ A: { object: SHA, sourceGameId: 1 } })).toBe('import-rpgm');
    expect(
      licenseTagFromSlots({
        A: { object: SHA, sourceGameId: 1 },
        B: { object: 'b'.repeat(64) },
      }),
    ).toBe('mixed');
  });
});

describe('community share offline queue', () => {
  it('skips null imported queue entries while preserving valid jobs', () => {
    const job = sampleJob('valid');
    expect(parseCommunityShareQueueJson(JSON.stringify([null, job]))).toEqual({
      ok: true,
      jobs: [job],
    });
  });

  it('keeps a newer save when a removal uses an older timestamp for the same map', () => {
    const storage = memoryStorage();
    const current = sampleJob('town', '2026-09-28T02:00:00.000Z');
    pushCommunityShareQueue(current, storage);

    expect(removeCommunityShareQueueJob('town', '2026-09-28T01:00:00.000Z', storage)).toEqual([
      current,
    ]);
    expect(loadCommunityShareQueue(storage)).toEqual([current]);
  });

  it('caps a pasted share queue at twenty jobs while preserving input order', () => {
    const jobs = Array.from({ length: 21 }, (_, index) => sampleJob(`import-${index}`));
    expect(parseCommunityShareQueueJson(JSON.stringify(jobs))).toEqual({
      ok: true,
      jobs: jobs.slice(0, 20),
    });
  });

  it('clears queued jobs through removeItem without removing community preferences', () => {
    const queueKey = 'threemaker-maker-studio:community-queue';
    const settingsKey = 'threemaker-maker-studio:community';
    const preferences = JSON.stringify({ shareOnSave: false, allowImportedAssets: true });
    const data = new Map([
      [queueKey, JSON.stringify([sampleJob('queued')])],
      [settingsKey, preferences],
    ]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };

    expect(clearCommunityShareQueue(storage)).toEqual([]);
    expect(loadCommunityShareQueue(storage)).toEqual([]);
    expect(storage.getItem(queueKey)).toBeNull();
    expect(storage.getItem(settingsKey)).toBe(preferences);
  });

  it('normalizes a non-finite version before replacing and persisting the queue', () => {
    const storage = memoryStorage();
    const job = { ...sampleJob('invalid-version'), version: Number.POSITIVE_INFINITY };
    const expected = { ...job, version: 0 };

    expect(replaceCommunityShareQueue([job], storage)).toEqual([expected]);
    expect(loadCommunityShareQueue(storage)).toEqual([expected]);
  });

  it('removes only the first imported job when map id and timestamp are duplicated', () => {
    const storage = memoryStorage();
    const first = { ...sampleJob('duplicate'), mapName: 'First imported copy' };
    const last = { ...sampleJob('duplicate'), mapName: 'Last imported copy' };
    const other = sampleJob('other');
    replaceCommunityShareQueue([first, other, last], storage);

    expect(removeCommunityShareQueueJob(first.mapId, first.at, storage)).toEqual([other, last]);
    expect(loadCommunityShareQueue(storage)).toEqual([other, last]);
  });

  it('preserves imported provenance when importing a queued job', () => {
    const job = { ...sampleJob('imported-job'), licenseTag: 'import-rpgm' as const };
    expect(parseCommunityShareQueueJson(JSON.stringify([job]))).toEqual({ ok: true, jobs: [job] });
  });

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

  it('retains at most twenty offline share jobs', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 21; i++) pushCommunityShareQueue(sampleJob(String(i)), storage);
    expect(loadCommunityShareQueue(storage)).toHaveLength(20);
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
    expect(after.map((j) => `${j.mapId}:${j.at}`)).toEqual([`c:${c.at}`, `a:${a.at}`]);
    expect(removeCommunityShareQueueJob('missing', a.at, storage)).toEqual(after);
    expect(loadCommunityShareQueue(storage).map((j) => j.mapId)).toEqual(['c', 'a']);
  });

  it('serializeCommunityShareQueue is pretty JSON of the queue', () => {
    const jobs = [sampleJob('z'), sampleJob('y')];
    const raw = serializeCommunityShareQueue(jobs);
    expect(JSON.parse(raw)).toEqual(jobs);
    expect(raw).toContain('\n');
  });

  it('single-job export round-trips through paste import (WU-COMM-14)', () => {
    const job = sampleJob('solo');
    expect(parseCommunityShareQueueJson(serializeCommunityShareQueue([job]))).toEqual({
      ok: true,
      jobs: [job],
    });
  });

  it('preserves mixed provenance when importing a queued job', () => {
    const job = { ...sampleJob('mixed-job'), licenseTag: 'mixed' as const };
    expect(parseCommunityShareQueueJson(JSON.stringify([job]))).toEqual({
      ok: true,
      jobs: [job],
    });
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

  it('rejects an imported queue job whose only invalid field is its map id', () => {
    const invalid = { ...sampleJob('valid'), mapId: 42 };
    expect(parseCommunityShareQueueJson(JSON.stringify([invalid]))).toEqual({
      ok: false,
      reason: 'no-valid-jobs',
    });
  });

  it('rejects an imported queue job with a non-string map name', () => {
    const invalid = { ...sampleJob('valid'), mapName: 42 };
    expect(parseCommunityShareQueueJson(JSON.stringify([invalid]))).toEqual({
      ok: false,
      reason: 'no-valid-jobs',
    });
  });

  it('rejects an imported queue job with a non-string timestamp', () => {
    const invalid = { ...sampleJob('valid'), at: 42 };
    expect(parseCommunityShareQueueJson(JSON.stringify([invalid]))).toEqual({
      ok: false,
      reason: 'no-valid-jobs',
    });
  });

  it('rejects an imported queue job with a non-string tile hash among valid hashes', () => {
    const invalid = { ...sampleJob('mixed-hashes'), tileObjectShas: ['a'.repeat(64), 42] };
    expect(parseCommunityShareQueueJson(JSON.stringify([invalid]))).toEqual({
      ok: false,
      reason: 'no-valid-jobs',
    });
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

  it('truncates a fractional version when importing a queued job', () => {
    const job = {
      mapId: 'fractional',
      mapName: 'Fractional',
      tileObjectShas: [],
      at: '2026-08-08T00:00:00.000Z',
      version: 2.9,
      licenseTag: 'user-owned',
    };
    expect(parseCommunityShareQueueJson(JSON.stringify([job]))).toEqual({
      ok: true,
      jobs: [{ ...job, version: 2 }],
    });
  });

  it('truncates a negative fractional version toward zero when importing', () => {
    const job = { ...sampleJob('negative-version'), version: -1.9 };
    const result = parseCommunityShareQueueJson(JSON.stringify([job]));
    expect(result.ok && result.jobs[0]?.version).toBe(-1);
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
      describeCommunityShareStatus({ shareOnSave: false, allowImportedAssets: false }, [
        sampleJob('a'),
      ]),
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
      describeCommunityShareStatus(DEFAULT_COMMUNITY_SETTINGS, [sampleJob('z'), sampleJob('y')]),
    ).toEqual({ kind: 'queued', queueLength: 2, lastMapName: 'Map z' });
  });
});

it('caps an oversized persisted share queue without reordering its jobs', () => {
  const jobs = Array.from({ length: 21 }, (_, index) => sampleJob(`stored-${index}`));
  const storage = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify(jobs),
  });
  expect(loadCommunityShareQueue(storage)).toEqual(jobs.slice(0, 20));
});

it('caps replacement jobs before returning and persisting the share queue', () => {
  const jobs = Array.from({ length: 21 }, (_, index) => sampleJob(`replacement-${index}`));
  const storage = memoryStorage();
  expect(replaceCommunityShareQueue(jobs, storage)).toEqual(jobs.slice(0, 20));
  expect(JSON.parse(storage.getItem('threemaker-maker-studio:community-queue') ?? 'null')).toEqual(
    jobs.slice(0, 20),
  );
});

it('drops malformed persisted queue entries while preserving valid jobs', () => {
  const job = sampleJob('valid-stored-job');
  const storage = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([null, job, { mapId: 42 }]),
  });
  expect(loadCommunityShareQueue(storage)).toEqual([job]);
});

it('leaves a missing queue job alone when storage writes are unavailable', () => {
  const job = sampleJob('remaining');
  const storage = {
    ...memoryStorage({ 'threemaker-maker-studio:community-queue': JSON.stringify([job]) }),
    setItem: () => {
      throw new Error('Storage writes are unavailable');
    },
  };
  expect(removeCommunityShareQueueJob('missing', job.at, storage)).toEqual([job]);
});

it('uses an ISO UTC timestamp when a share is enqueued without a clock', () => {
  const job = maybeEnqueueCommunityShare(DEFAULT_COMMUNITY_SETTINGS, {
    mapId: 'default-clock',
    mapName: 'Default clock',
    tileObjectShas: [],
    usesOnlyImportedAssets: false,
  });
  expect(job?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

it('normalizes an unrecognized imported license tag to user-owned', () => {
  const job = sampleJob('unknown-license');
  const raw = JSON.stringify([{ ...job, licenseTag: 'user' }]);

  expect(parseCommunityShareQueueJson(raw)).toEqual({ ok: true, jobs: [job] });
});

it('loads community preferences from local storage when no storage is supplied', () => {
  const preferences = { shareOnSave: false, allowImportedAssets: true };
  vi.stubGlobal(
    'localStorage',
    memoryStorage({ 'threemaker-maker-studio:community': JSON.stringify(preferences) }),
  );
  vi.stubGlobal('sessionStorage', memoryStorage());
  try {
    expect(loadCommunitySettings()).toEqual(preferences);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('loads offline share jobs from local storage when no storage is supplied', () => {
  const job = sampleJob('persistent-share');
  vi.stubGlobal(
    'localStorage',
    memoryStorage({ 'threemaker-maker-studio:community-queue': JSON.stringify([job]) }),
  );
  vi.stubGlobal('sessionStorage', memoryStorage());
  try {
    expect(loadCommunityShareQueue()).toEqual([job]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('saves community preferences to local storage when no storage is supplied', () => {
  const persistent = memoryStorage();
  const session = memoryStorage();
  const preferences = { shareOnSave: false, allowImportedAssets: true };
  vi.stubGlobal('localStorage', persistent);
  vi.stubGlobal('sessionStorage', session);
  try {
    saveCommunitySettings(preferences);

    expect(loadCommunitySettings(persistent)).toEqual(preferences);
    expect(session.getItem('threemaker-maker-studio:community')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('prepends share jobs in local storage when no storage is supplied', () => {
  const previous = sampleJob('previous');
  const added = sampleJob('added');
  const sessionJob = sampleJob('session');
  const persistent = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([previous]),
  });
  const session = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([sessionJob]),
  });
  vi.stubGlobal('localStorage', persistent);
  vi.stubGlobal('sessionStorage', session);
  try {
    expect(pushCommunityShareQueue(added)).toEqual([added, previous]);
    expect(loadCommunityShareQueue(persistent)).toEqual([added, previous]);
    expect(loadCommunityShareQueue(session)).toEqual([sessionJob]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('clears share jobs from local storage when no storage is supplied', () => {
  const job = sampleJob('persistent');
  const sessionJob = sampleJob('session');
  const persistent = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([job]),
  });
  const session = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([sessionJob]),
  });
  vi.stubGlobal('localStorage', persistent);
  vi.stubGlobal('sessionStorage', session);
  try {
    expect(clearCommunityShareQueue()).toEqual([]);
    expect(loadCommunityShareQueue(persistent)).toEqual([]);
    expect(loadCommunityShareQueue(session)).toEqual([sessionJob]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('removes a share job from local storage when no storage is supplied', () => {
  const removed = sampleJob('removed');
  const retained = sampleJob('retained');
  const sessionJob = sampleJob('session');
  const persistent = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([removed, retained]),
  });
  const session = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([sessionJob]),
  });
  vi.stubGlobal('localStorage', persistent);
  vi.stubGlobal('sessionStorage', session);
  try {
    expect(removeCommunityShareQueueJob(removed.mapId, removed.at)).toEqual([retained]);
    expect(loadCommunityShareQueue(persistent)).toEqual([retained]);
    expect(loadCommunityShareQueue(session)).toEqual([sessionJob]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('replaces share jobs in local storage when no storage is supplied', () => {
  const previous = sampleJob('previous');
  const replacement = sampleJob('replacement');
  const sessionJob = sampleJob('session');
  const persistent = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([previous]),
  });
  const session = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([sessionJob]),
  });
  vi.stubGlobal('localStorage', persistent);
  vi.stubGlobal('sessionStorage', session);
  try {
    expect(replaceCommunityShareQueue([replacement])).toEqual([replacement]);
    expect(loadCommunityShareQueue(persistent)).toEqual([replacement]);
    expect(loadCommunityShareQueue(session)).toEqual([sessionJob]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('counts a one-character tile reference in a share job', () => {
  expect(communityShareTileCount(['x', 'x', ''])).toBe(1);
});

it('counts a shared one-character tile reference once across queued jobs', () => {
  expect(
    communityShareQueueTileTotal([{ tileObjectShas: ['x'] }, { tileObjectShas: ['x', ''] }]),
  ).toBe(1);
});

it('distinguishes queue timestamps saved in consecutive minutes', () => {
  const first = formatCommunityShareAt('2026-09-29T13:07:00.000Z', 'en-US');
  const next = formatCommunityShareAt('2026-09-29T13:08:00.000Z', 'en-US');

  expect(first).not.toBe(next);
});

it('distinguishes queue timestamps saved in different hours', () => {
  const first = formatCommunityShareAt('2026-09-29T13:07:00.000Z', 'en-US');
  const next = formatCommunityShareAt('2026-09-29T14:07:00.000Z', 'en-US');

  expect(first).not.toBe(next);
});

it('keeps an older queued save when removal requests a future timestamp', () => {
  const job = sampleJob('harbor', '2026-09-29T12:00:00.000Z');
  const storage = memoryStorage({
    'threemaker-maker-studio:community-queue': JSON.stringify([job]),
  });

  expect(removeCommunityShareQueueJob(job.mapId, '2026-09-29T13:00:00.000Z', storage)).toEqual([
    job,
  ]);
  expect(loadCommunityShareQueue(storage)).toEqual([job]);
});
