import { describe, expect, it } from 'vitest';
import { resolveViewKeyAction } from '../src/view-input.js';

describe('resolveViewKeyAction', () => {
  it('maps view keys on keydown', () => {
    expect(resolveViewKeyAction('p', 'down')).toEqual({ kind: 'toggle-post-processing' });
    expect(resolveViewKeyAction('C', 'down')).toEqual({ kind: 'cycle-camera-mode' });
    expect(resolveViewKeyAction('[', 'down')).toEqual({ kind: 'tilt', delta: -1 });
    expect(resolveViewKeyAction(']', 'down')).toEqual({ kind: 'tilt', delta: 1 });
    expect(resolveViewKeyAction('-', 'down')).toEqual({ kind: 'zoom', delta: 1 });
    expect(resolveViewKeyAction('_', 'down')).toEqual({ kind: 'zoom', delta: 1 });
    expect(resolveViewKeyAction('=', 'down')).toEqual({ kind: 'zoom', delta: -1 });
    expect(resolveViewKeyAction('+', 'down')).toEqual({ kind: 'zoom', delta: -1 });
    expect(resolveViewKeyAction('Control', 'down')).toEqual({ kind: 'noclip-on' });
  });

  it('only maps Control on keyup (noclip release)', () => {
    expect(resolveViewKeyAction('Control', 'up')).toEqual({ kind: 'noclip-off' });
    expect(resolveViewKeyAction('p', 'up')).toBeUndefined();
    expect(resolveViewKeyAction('c', 'up')).toBeUndefined();
  });

  it('returns undefined for unmapped keys', () => {
    expect(resolveViewKeyAction('g', 'down')).toBeUndefined();
    expect(resolveViewKeyAction('e', 'down')).toBeUndefined();
    expect(resolveViewKeyAction('ArrowUp', 'down')).toBeUndefined();
  });
});
