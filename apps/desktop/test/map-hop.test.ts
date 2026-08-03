import { describe, expect, it } from 'vitest';
import {
  canBeginMapHop,
  decideTransferMapHost,
  findManifestMapIndex,
  isMapCycleKey,
  type ManifestMapFileEntry,
  type MapHopGuardInput,
  type MapHopRefusal,
  nextManifestMapIndex,
  planManifestHop,
  planNextManifestCycle,
  resolveHopArrival,
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

/**
 * hopToManifestFile pre-flight: guard then resolve. Pure so transferMap /
 * G-cycle share one tested plan before any dispose/load.
 */
describe('planManifestHop', () => {
  it('returns target index and canonical manifest file when idle and mapFile resolves', () => {
    expect(
      planManifestHop({
        guard: guards(),
        maps: maps('demo/map-a.tmmap.json', 'demo/map-b.tmmap.json'),
        mapFile: 'map-b.tmmap.json',
      }),
    ).toEqual({ ok: true, index: 1, file: 'demo/map-b.tmmap.json' });
  });

  it('refuses with hop-guard reason before looking up the mapFile', () => {
    expect(
      planManifestHop({
        guard: guards({ interpreterState: 'waiting-for-dialogue' }),
        maps: maps('demo/map-b.tmmap.json'),
        mapFile: 'map-b.tmmap.json',
      }),
    ).toEqual({ ok: false, reason: 'interpreter-busy' });
  });

  it('refuses with lookup reason when the guard passes but mapFile is missing', () => {
    expect(
      planManifestHop({
        guard: guards(),
        maps: maps('demo/map-a.tmmap.json'),
        mapFile: 'map-b.tmmap.json',
      }),
    ).toEqual({ ok: false, reason: 'not-in-manifest' });
  });

  it('refuses ambiguous basename after the guard passes', () => {
    expect(
      planManifestHop({
        guard: guards(),
        maps: maps('a/door.tmmap.json', 'b/door.tmmap.json'),
        mapFile: 'door.tmmap.json',
      }),
    ).toEqual({ ok: false, reason: 'ambiguous-basename' });
  });

  it('C1b product chain: transferMap host accept + plan resolves A→B basename', () => {
    const host = decideTransferMapHost({
      hopPathActive: true,
      hopInFlight: false,
      activeTraversal: false,
      mapFile: 'map-b.tmmap.json',
      x: 1,
      y: 1,
      facing: 'down',
    });
    expect(host.ok).toBe(true);
    if (!host.ok) return;

    const plan = planManifestHop({
      guard: guards(),
      maps: maps('demo/map-a.tmmap.json', 'demo/map-b.tmmap.json'),
      mapFile: host.mapFile,
    });
    expect(plan).toEqual({ ok: true, index: 1, file: 'demo/map-b.tmmap.json' });
    expect(host.arrival).toEqual({ x: 1, y: 1, facing: 'down' });
  });
});

describe('isMapCycleKey', () => {
  it('accepts G in any casing (manifest multi-map / dev cycle)', () => {
    expect(isMapCycleKey('g')).toBe(true);
    expect(isMapCycleKey('G')).toBe(true);
  });

  it('rejects non-cycle keys', () => {
    expect(isMapCycleKey('e')).toBe(false);
    expect(isMapCycleKey('Enter')).toBe(false);
  });
});

describe('planNextManifestCycle', () => {
  it('returns the next entry file and wraps at the end', () => {
    const list = maps('demo/map-a.tmmap.json', 'demo/map-b.tmmap.json');
    expect(planNextManifestCycle(list, 0)).toEqual({
      index: 1,
      file: 'demo/map-b.tmmap.json',
    });
    expect(planNextManifestCycle(list, 1)).toEqual({
      index: 0,
      file: 'demo/map-a.tmmap.json',
    });
  });

  it('stays on the sole entry when the manifest has one map', () => {
    expect(planNextManifestCycle(maps('only.tmmap.json'), 0)).toEqual({
      index: 0,
      file: 'only.tmmap.json',
    });
  });

  it('returns undefined for an empty maps list (no cycle to advance)', () => {
    expect(planNextManifestCycle([], 0)).toBeUndefined();
  });
});

/**
 * After a hop plan succeeds and the dest map loads: turn the request
 * (authored spawn vs transferMap coords) into session spawn + optional facing.
 */
describe('resolveHopArrival', () => {
  const destSpawn = { x: 3, y: 4, floorIndex: 1 };

  it('uses the destination authored spawn for G-cycle (arrival authored)', () => {
    expect(resolveHopArrival('authored', destSpawn)).toEqual({
      spawn: { x: 3, y: 4, floorIndex: 1 },
    });
  });

  it('returns undefined when G-cycle arrives but dest has no authored spawn', () => {
    expect(resolveHopArrival('authored', undefined)).toBeUndefined();
  });

  it('uses transferMap coords and keeps dest floor when present', () => {
    expect(resolveHopArrival({ x: 1, y: 2, facing: 'down' }, destSpawn)).toEqual({
      spawn: { x: 1, y: 2, floorIndex: 1 },
      facing: 'down',
    });
  });

  it('defaults floorIndex to 0 when dest spawn is missing on a transfer hop', () => {
    expect(resolveHopArrival({ x: 5, y: 6 }, undefined)).toEqual({
      spawn: { x: 5, y: 6, floorIndex: 0 },
    });
  });

  it('omits facing when the transfer command did not author one', () => {
    const resolved = resolveHopArrival({ x: 0, y: 0 }, destSpawn);
    expect(resolved).toEqual({ spawn: { x: 0, y: 0, floorIndex: 1 } });
    if (resolved) expect('facing' in resolved).toBe(false);
  });
});
