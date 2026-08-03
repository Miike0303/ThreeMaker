import { describe, expect, it } from 'vitest';
import {
  canBeginMapHop,
  findManifestMapIndex,
  type ManifestMapFileEntry,
  type MapHopGuardInput,
  type MapHopRefusal,
  nextManifestMapIndex,
} from '../src/map-hop.js';

function guards(partial: Partial<MapHopGuardInput> = {}): MapHopGuardInput {
  return {
    hopInFlight: false,
    interpreterState: 'idle',
    activeTraversal: false,
    ...partial,
  };
}

function maps(...files: string[]): readonly ManifestMapFileEntry[] {
  return files.map((file) => ({ file }));
}

describe('canBeginMapHop', () => {
  it('allows a hop when idle, not traversing, and no hop is already in flight', () => {
    expect(canBeginMapHop(guards())).toEqual({ ok: true });
  });

  it('refuses when a hop is already in flight', () => {
    const result = canBeginMapHop(guards({ hopInFlight: true }));
    expect(result).toEqual({ ok: false, reason: 'hop-in-flight' satisfies MapHopRefusal });
  });

  it('refuses mid-script when the interpreter is not idle (R6 swap-refusal seam)', () => {
    for (const interpreterState of [
      'running',
      'waiting-for-dialogue',
      'waiting-for-choice',
    ] as const) {
      expect(canBeginMapHop(guards({ interpreterState }))).toEqual({
        ok: false,
        reason: 'interpreter-busy',
      });
    }
  });

  it('refuses while a stair traversal is active', () => {
    expect(canBeginMapHop(guards({ activeTraversal: true }))).toEqual({
      ok: false,
      reason: 'traversal-active',
    });
  });

  it('priority: hop-in-flight wins over interpreter-busy and traversal', () => {
    expect(
      canBeginMapHop(
        guards({ hopInFlight: true, interpreterState: 'running', activeTraversal: true }),
      ),
    ).toEqual({ ok: false, reason: 'hop-in-flight' });
  });

  it('priority: interpreter-busy wins over traversal when no hop is in flight', () => {
    expect(
      canBeginMapHop(guards({ interpreterState: 'waiting-for-choice', activeTraversal: true })),
    ).toEqual({ ok: false, reason: 'interpreter-busy' });
  });
});

describe('nextManifestMapIndex', () => {
  it('advances and wraps within the manifest length', () => {
    expect(nextManifestMapIndex(0, 3)).toBe(1);
    expect(nextManifestMapIndex(1, 3)).toBe(2);
    expect(nextManifestMapIndex(2, 3)).toBe(0);
  });

  it('stays at 0 when the manifest has a single entry', () => {
    expect(nextManifestMapIndex(0, 1)).toBe(0);
  });

  it('throws on a non-positive mapCount (programming error, not a content failure)', () => {
    expect(() => nextManifestMapIndex(0, 0)).toThrow(/mapCount/i);
    expect(() => nextManifestMapIndex(0, -1)).toThrow(/mapCount/i);
  });
});

/**
 * transferMap authors often write the basename (`map-b.tmmap.json`) while the
 * converted game manifest stores a path under the game folder
 * (`kingdom/map-b.tmmap.json`). Exact match is preferred; unique basename is
 * accepted; ambiguous basename must not pick silently.
 */
describe('findManifestMapIndex', () => {
  it('returns the exact file match when present', () => {
    const list = maps('town/map001.tmmap.json', 'town/map002.tmmap.json');
    expect(findManifestMapIndex(list, 'town/map002.tmmap.json')).toEqual({
      ok: true,
      index: 1,
    });
  });

  it('matches a unique basename when the authored mapFile omits the folder prefix', () => {
    const list = maps('kingdom-of-subversion/map007.tmmap.json', 'hub/map001.tmmap.json');
    expect(findManifestMapIndex(list, 'map007.tmmap.json')).toEqual({
      ok: true,
      index: 0,
    });
  });

  it('prefers exact path over a same-basename entry elsewhere', () => {
    const list = maps('a/map.tmmap.json', 'b/map.tmmap.json');
    expect(findManifestMapIndex(list, 'b/map.tmmap.json')).toEqual({ ok: true, index: 1 });
  });

  it('refuses when no exact or basename match exists', () => {
    const list = maps('town/map001.tmmap.json');
    expect(findManifestMapIndex(list, 'missing.tmmap.json')).toEqual({
      ok: false,
      reason: 'not-in-manifest',
    });
  });

  it('refuses an ambiguous basename that matches two manifest entries', () => {
    const list = maps('a/door.tmmap.json', 'b/door.tmmap.json');
    expect(findManifestMapIndex(list, 'door.tmmap.json')).toEqual({
      ok: false,
      reason: 'ambiguous-basename',
    });
  });

  it('refuses an empty mapFile (content bug, not a silent first-entry hop)', () => {
    expect(findManifestMapIndex(maps('a.tmmap.json'), '')).toEqual({
      ok: false,
      reason: 'not-in-manifest',
    });
  });

  it('normalizes backslashes so Windows-authored paths still match', () => {
    const list = maps('town/map001.tmmap.json');
    expect(findManifestMapIndex(list, 'town\\map001.tmmap.json')).toEqual({
      ok: true,
      index: 0,
    });
  });
});
