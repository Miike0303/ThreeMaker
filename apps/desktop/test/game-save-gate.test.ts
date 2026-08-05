import { describe, expect, it } from 'vitest';
import { canLoadGameProgress, canSaveGameProgress } from '../src/game-save-gate.js';

describe('canSaveGameProgress', () => {
  it('allows save when idle and not hopping/traversing', () => {
    expect(canSaveGameProgress({ hopInFlight: false, activeTraversal: false })).toEqual({
      ok: true,
    });
  });

  it('allows save while dialogue would be open (interpreter not checked)', () => {
    // Host may call this during waiting-for-dialogue — save is intentional.
    expect(canSaveGameProgress({ hopInFlight: false, activeTraversal: false })).toEqual({
      ok: true,
    });
  });

  it('refuses mid-hop and mid-traversal', () => {
    expect(canSaveGameProgress({ hopInFlight: true, activeTraversal: false })).toEqual({
      ok: false,
      reason: 'hop-in-flight',
    });
    expect(canSaveGameProgress({ hopInFlight: false, activeTraversal: true })).toEqual({
      ok: false,
      reason: 'traversal-active',
    });
  });
});

describe('canLoadGameProgress', () => {
  it('allows load when hop-ready (idle, not hopping/traversing)', () => {
    expect(
      canLoadGameProgress({
        hopInFlight: false,
        interpreterState: 'idle',
        activeTraversal: false,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses load mid-dialogue/script, hop, or traversal', () => {
    expect(
      canLoadGameProgress({
        hopInFlight: false,
        interpreterState: 'waiting-for-dialogue',
        activeTraversal: false,
      }),
    ).toEqual({ ok: false, reason: 'interpreter-busy' });
    expect(
      canLoadGameProgress({
        hopInFlight: true,
        interpreterState: 'idle',
        activeTraversal: false,
      }),
    ).toEqual({ ok: false, reason: 'hop-in-flight' });
    expect(
      canLoadGameProgress({
        hopInFlight: false,
        interpreterState: 'idle',
        activeTraversal: true,
      }),
    ).toEqual({ ok: false, reason: 'traversal-active' });
  });
});
