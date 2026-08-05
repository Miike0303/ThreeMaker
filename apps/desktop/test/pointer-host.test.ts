import type { PointerHitTarget } from '@threemaker/input';
import { describe, expect, it } from 'vitest';
import { pointerTargetFromDialogueHit } from '../src/pointer-host.js';

describe('pointerTargetFromDialogueHit', () => {
  it('returns choice target when data-choice-index is a non-negative integer', () => {
    expect(pointerTargetFromDialogueHit('0')).toEqual({
      kind: 'choice',
      index: 0,
    } satisfies PointerHitTarget);
    expect(pointerTargetFromDialogueHit('3')).toEqual({ kind: 'choice', index: 3 });
  });

  it('returns actionable when the hit is dialogue chrome without a choice index', () => {
    expect(pointerTargetFromDialogueHit(null)).toEqual({ kind: 'actionable' });
    expect(pointerTargetFromDialogueHit(undefined)).toEqual({ kind: 'actionable' });
    expect(pointerTargetFromDialogueHit('')).toEqual({ kind: 'actionable' });
    expect(pointerTargetFromDialogueHit('nope')).toEqual({ kind: 'actionable' });
    expect(pointerTargetFromDialogueHit('-1')).toEqual({ kind: 'actionable' });
  });
});
