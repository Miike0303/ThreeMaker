/**
 * L4 WU-02: pure path + story-id gates for `.ink` sidecars next to the map
 * (desktop design D7: `<mapBase>.<storyId>.ink`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInkStoryOpenModel,
  inkSidecarRelativePath,
  isSafeStoryId,
  listInkSidecars,
  listInkStoryIdsFromEvents,
  tryCompileInkSource,
} from '../src/ink-sidecar.js';
import { listInkStoryIdsFromEntries, mapFileRelativePath } from '../src/map-identity.js';

describe('isSafeStoryId / inkSidecarRelativePath', () => {
  it('accepts only path-safe story ids', () => {
    expect(isSafeStoryId('elder')).toBe(true);
    expect(isSafeStoryId('gate_01')).toBe(true);
    expect(isSafeStoryId('A-b')).toBe(true);
    expect(isSafeStoryId('')).toBe(false);
    expect(isSafeStoryId('../evil')).toBe(false);
    expect(isSafeStoryId('has.dot')).toBe(false);
    expect(isSafeStoryId('has space')).toBe(false);
  });

  it('derives <mapBase>.<storyId>.ink from .tmmap.json paths', () => {
    expect(inkSidecarRelativePath('.threemaker/maps/current.tmmap.json', 'elder')).toBe(
      '.threemaker/maps/current.elder.ink',
    );
    expect(inkSidecarRelativePath('maps/map-a.tmmap.json', 'guard')).toBe('maps/map-a.guard.ink');
  });

  it('throws on unsafe story ids before path join', () => {
    expect(() => inkSidecarRelativePath('m.tmmap.json', '../x')).toThrow(/story id/i);
  });

  it('listed story ids stay inside the maps directory when re-joined', () => {
    const entries = [
      'current.elder.ink',
      'current.gate_01.ink',
      'current../escape.ink',
      'current.foo/bar.ink',
      'notes.txt',
    ];
    const ids = listInkStoryIdsFromEntries(entries, 'current');
    expect(ids).toEqual(['elder', 'gate_01']);
    for (const storyId of ids) {
      expect(isSafeStoryId(storyId)).toBe(true);
      const relative = inkSidecarRelativePath(mapFileRelativePath('current'), storyId);
      expect(relative).toBe(`.threemaker/maps/current.${storyId}.ink`);
    }
  });
});

describe('buildInkStoryOpenModel', () => {
  it('offers known ids and reports empty / ready / unknown / unsafe typed values', () => {
    expect(buildInkStoryOpenModel(['elder', 'guard'], '')).toEqual({
      storyOptions: ['elder', 'guard'],
      status: 'empty',
    });
    expect(buildInkStoryOpenModel(['elder', 'guard'], 'elder')).toMatchObject({
      status: 'ready',
    });
    expect(buildInkStoryOpenModel(['elder'], 'new-story')).toMatchObject({
      status: 'unknown-story',
    });
    expect(buildInkStoryOpenModel(['elder'], '../evil')).toMatchObject({
      status: 'unsafe-story-id',
    });
  });
});

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeTextFile: vi.fn(async () => undefined),
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
  readDir: vi.fn(async () => [] as { name: string }[]),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: fsMocks.mkdir,
  writeTextFile: fsMocks.writeTextFile,
  readTextFile: fsMocks.readTextFile,
  exists: fsMocks.exists,
  readDir: fsMocks.readDir,
  BaseDirectory: { Home: 'Home' },
}));

describe('listInkSidecars (Tauri fs branch)', () => {
  beforeEach(() => {
    fsMocks.exists.mockReset();
    fsMocks.readDir.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubTauriHost(): void {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  }

  it('lists story ids from sidecars next to the named map', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      { name: 'town.tmmap.json' },
      { name: 'town.elder.ink' },
      { name: 'town.guard.ink' },
      { name: 'current.welcome.ink' },
      { name: 'town../escape.ink' },
    ]);

    expect(await listInkSidecars('town')).toEqual(['elder', 'guard']);
  });

  it('returns [] when the maps directory does not exist', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(false);
    expect(await listInkSidecars('town')).toEqual([]);
    expect(fsMocks.readDir).not.toHaveBeenCalled();
  });

  it('rejects a traversal map name before reading the directory', async () => {
    stubTauriHost();
    await expect(listInkSidecars('../evil')).rejects.toThrow(/map name|Invalid map/i);
    expect(fsMocks.readDir).not.toHaveBeenCalled();
    expect(fsMocks.exists).not.toHaveBeenCalled();
  });
});

describe('listInkSidecars (dev-HTTP fallback)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('filters /ink-list payloads through the sidecar filename convention', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(['elder', 'guard', '../evil']), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await listInkSidecars('town')).toEqual(['elder', 'guard']);
    expect(fetchMock).toHaveBeenCalledWith('/api/dev-map/ink-list?name=town');
  });

  it('rejects a traversal map name before fetching', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(listInkSidecars('../evil')).rejects.toThrow(/map name|Invalid map/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listInkStoryIdsFromEvents', () => {
  it('collects unique ink storyIds from showDialogue (incl. nested conditionals)', () => {
    const ids = listInkStoryIdsFromEvents({
      a: [
        { type: 'showDialogue', source: { kind: 'ink', storyId: 'elder', knot: 'start' } },
        { type: 'showDialogue', source: { kind: 'text', lines: ['hi'] } },
      ],
      b: [
        {
          type: 'conditional',
          if: { key: 'x', op: 'eq', value: true },
          then: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'guard' } }],
          else: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'elder' } }],
        },
      ],
    });
    expect(ids).toEqual(['elder', 'guard']);
  });
});

describe('tryCompileInkSource', () => {
  it('returns ok for a minimal valid story', () => {
    const result = tryCompileInkSource('=== start ===\nHello\n');
    expect(result.ok).toBe(true);
  });

  it('returns structured issues for invalid ink', () => {
    const result = tryCompileInkSource('=== start ===\n-> missing_knot\n');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
