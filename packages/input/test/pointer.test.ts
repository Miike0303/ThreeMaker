import { describe, expect, it } from 'vitest';
import { resolvePointerIntent } from '../src/pointer.js';
import { Actions } from '../src/types.js';

describe('resolvePointerIntent', () => {
  it('maps primary down on an actionable target to interact pressed', () => {
    expect(
      resolvePointerIntent({
        phase: 'down',
        button: 0,
        target: { kind: 'actionable' },
      }),
    ).toEqual({
      kind: 'action',
      edge: { action: Actions.Interact, edge: 'pressed' },
    });
  });

  it('maps primary down on a choice target to chooseIndex (host dialogue hit)', () => {
    expect(
      resolvePointerIntent({
        phase: 'down',
        button: 0,
        target: { kind: 'choice', index: 2 },
      }),
    ).toEqual({ kind: 'chooseIndex', index: 2 });
  });

  it('ignores pointer up (interact is one-shot; no release edge)', () => {
    expect(
      resolvePointerIntent({
        phase: 'up',
        button: 0,
        target: { kind: 'actionable' },
      }),
    ).toBeUndefined();
    expect(
      resolvePointerIntent({
        phase: 'up',
        button: 0,
        target: { kind: 'choice', index: 0 },
      }),
    ).toBeUndefined();
  });

  it('ignores non-primary buttons', () => {
    expect(
      resolvePointerIntent({
        phase: 'down',
        button: 1,
        target: { kind: 'actionable' },
      }),
    ).toBeUndefined();
    expect(
      resolvePointerIntent({
        phase: 'down',
        button: 2,
        target: { kind: 'choice', index: 0 },
      }),
    ).toBeUndefined();
  });

  it('ignores host-marked ignored targets (chrome / debug UI)', () => {
    expect(
      resolvePointerIntent({
        phase: 'down',
        button: 0,
        target: { kind: 'ignored' },
      }),
    ).toBeUndefined();
  });
});
