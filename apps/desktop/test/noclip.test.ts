/**
 * `withNoclip` (rpgm-whole-game-import, Ctrl noclip debug mode): wraps a
 * `GridMover` passability check so movement ignores it entirely while
 * `isNoclipActive()` returns true, and never permanently re-traps the
 * player on release -- if they're currently standing on a tile that fails
 * its own standability (walked there via noclip, or any other means),
 * stepping to an adjacent tile that IS standable is still allowed even with
 * noclip off, instead of leaving them stuck forever.
 */
import { describe, expect, it, vi } from 'vitest';
import { withNoclip } from '../src/noclip.js';

describe('withNoclip', () => {
  it('bypasses the wrapped canMove entirely while noclip is active', () => {
    const canMove = vi.fn(() => false);
    const grid = { isStandable: vi.fn(() => false) };
    const wrapped = withNoclip(() => true, grid, canMove);

    expect(wrapped(5, 5, 'right')).toBe(true);
    expect(canMove).not.toHaveBeenCalled();
  });

  it('delegates to the wrapped canMove when noclip is inactive and the move is allowed', () => {
    const canMove = vi.fn(() => true);
    const grid = { isStandable: vi.fn(() => true) };
    const wrapped = withNoclip(() => false, grid, canMove);

    expect(wrapped(1, 2, 'up')).toBe(true);
    expect(canMove).toHaveBeenCalledWith(1, 2, 'up');
  });

  it('blocks a move when noclip is inactive, the wrapped canMove refuses, and the current tile is itself standable (normal block stands)', () => {
    const canMove = vi.fn(() => false);
    const grid = { isStandable: vi.fn(() => true) };
    const wrapped = withNoclip(() => false, grid, canMove);

    expect(wrapped(1, 2, 'up')).toBe(false);
  });

  it('allows escaping when the current tile is not standable (e.g. released Ctrl inside a wall) and the destination is standable', () => {
    const canMove = vi.fn(() => false); // the normal check still refuses (origin flags trap it)
    const grid = {
      isStandable: vi.fn((x: number, _y: number) => x !== 1), // (1,*) is the trapped origin; everywhere else is fine
    };
    const wrapped = withNoclip(() => false, grid, canMove);

    // Origin (1,2) is not standable; moving right lands on (2,2), which IS standable.
    expect(wrapped(1, 2, 'right')).toBe(true);
  });

  it('still blocks the escape when the destination is ALSO not standable', () => {
    const canMove = vi.fn(() => false);
    const grid = { isStandable: vi.fn(() => false) }; // origin AND destination both unstandable
    const wrapped = withNoclip(() => false, grid, canMove);

    expect(wrapped(1, 2, 'right')).toBe(false);
  });
});
