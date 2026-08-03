import { describe, expect, it } from 'vitest';
import {
  canBeginMapHop,
  decideTransferMapHost,
  findManifestMapIndex,
  type ManifestMapFileEntry,
  type MapHopGuardInput,
  type MapHopRefusal,
  nextManifestMapIndex,
  type TransferMapHostRefusal,
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

  it('resolves the C1b transfer fixture mapFile against a prefixed multi-map manifest', () => {
    // Product path: authors write basenames; convert-rpgm-game stores game/file.
    const list = maps('demo/map-a.tmmap.json', 'demo/map-b.tmmap.json');
    expect(findManifestMapIndex(list, 'map-b.tmmap.json')).toEqual({ ok: true, index: 1 });
    expect(findManifestMapIndex(list, 'map-a.tmmap.json')).toEqual({ ok: true, index: 0 });
  });
});

/**
 * EventHost.transferMap early gate (before microtask hop). Separate from
 * canBeginMapHop: the host must call done() even when refusing so the
 * interpreter returns to idle, and "no multi-map path" is not a hop guard.
 */
describe('decideTransferMapHost', () => {
  it('accepts a transfer when the multi-map hop path is live and idle', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: true,
        hopInFlight: false,
        activeTraversal: false,
        mapFile: 'map-b.tmmap.json',
        x: 1,
        y: 2,
        facing: 'down',
      }),
    ).toEqual({
      ok: true,
      mapFile: 'map-b.tmmap.json',
      arrival: { x: 1, y: 2, facing: 'down' },
    });
  });

  it('omits facing from arrival when the command did not author one', () => {
    const decision = decideTransferMapHost({
      hopPathActive: true,
      hopInFlight: false,
      activeTraversal: false,
      mapFile: 'map-b.tmmap.json',
      x: 0,
      y: 0,
    });
    expect(decision).toEqual({
      ok: true,
      mapFile: 'map-b.tmmap.json',
      arrival: { x: 0, y: 0 },
    });
    if (decision.ok) {
      expect('facing' in decision.arrival).toBe(false);
    }
  });

  it('refuses when no multi-map hop path is installed (single-map / no manifest)', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: false,
        hopInFlight: false,
        activeTraversal: false,
        mapFile: 'map-b.tmmap.json',
        x: 0,
        y: 0,
      }),
    ).toEqual({ ok: false, reason: 'no-hop-path' satisfies TransferMapHostRefusal });
  });

  it('refuses when a hop is already in flight', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: true,
        hopInFlight: true,
        activeTraversal: false,
        mapFile: 'map-b.tmmap.json',
        x: 0,
        y: 0,
      }),
    ).toEqual({ ok: false, reason: 'hop-in-flight' });
  });

  it('refuses while a stair traversal is active', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: true,
        hopInFlight: false,
        activeTraversal: true,
        mapFile: 'map-b.tmmap.json',
        x: 0,
        y: 0,
      }),
    ).toEqual({ ok: false, reason: 'traversal-active' });
  });

  it('priority: no-hop-path wins over in-flight / traversal', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: false,
        hopInFlight: true,
        activeTraversal: true,
        mapFile: 'x.tmmap.json',
        x: 0,
        y: 0,
      }),
    ).toEqual({ ok: false, reason: 'no-hop-path' });
  });

  it('priority: hop-in-flight wins over traversal when the hop path is active', () => {
    expect(
      decideTransferMapHost({
        hopPathActive: true,
        hopInFlight: true,
        activeTraversal: true,
        mapFile: 'x.tmmap.json',
        x: 0,
        y: 0,
      }),
    ).toEqual({ ok: false, reason: 'hop-in-flight' });
  });
});
