import { describe, expect, it } from 'vitest';
import {
  canBeginMapHop,
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
