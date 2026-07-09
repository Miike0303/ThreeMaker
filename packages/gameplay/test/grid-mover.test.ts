import { describe, expect, it, vi } from 'vitest';
import type { Direction } from '../src/grid-mover.js';
import { GridMover } from '../src/grid-mover.js';

const SPEED = 4; // tiles/second -> one tile every 0.25s
const STEP_TIME = 1 / SPEED;

describe('GridMover (idle/turn behavior)', () => {
  it('starts idle, facing the given direction, at the given tile', () => {
    const mover = new GridMover({ x: 2, y: 3, facing: 'left' });

    expect(mover.tile).toEqual({ x: 2, y: 3 });
    expect(mover.facing).toBe('left');
    expect(mover.moving).toBe(false);
    expect(mover.progress).toBe(0);
    expect(mover.renderPosition).toEqual({ x: 2, y: 3 });
  });

  it('defaults facing to "down" and speed to 4 tiles/second', () => {
    const mover = new GridMover({ x: 0, y: 0 });
    mover.requestMove('down');
    mover.update(STEP_TIME);

    // Already facing "down" by default, so this single request moves
    // immediately instead of only turning.
    expect(mover.tile).toEqual({ x: 0, y: 1 });
  });

  it('turns to face a new direction first without moving, when idle', () => {
    const mover = new GridMover({ x: 5, y: 5, facing: 'down', speed: SPEED });

    mover.requestMove('right');
    mover.update(STEP_TIME);

    expect(mover.facing).toBe('right');
    expect(mover.tile).toEqual({ x: 5, y: 5 });
    expect(mover.moving).toBe(false);
  });

  it('moves on the next request once already facing that direction', () => {
    const mover = new GridMover({ x: 5, y: 5, facing: 'down', speed: SPEED });

    mover.requestMove('right'); // turn only
    mover.update(STEP_TIME);
    mover.requestMove('right'); // now moves
    mover.update(STEP_TIME);

    expect(mover.facing).toBe('right');
    expect(mover.tile).toEqual({ x: 6, y: 5 });
    expect(mover.moving).toBe(false);
  });

  it('moves immediately when already facing the requested direction', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'down', speed: SPEED });

    mover.requestMove('down');
    mover.update(STEP_TIME);

    expect(mover.tile).toEqual({ x: 0, y: 1 });
    expect(mover.moving).toBe(false);
  });
});

describe('GridMover (step interpolation timing)', () => {
  it('completes a step in exactly 1/speed seconds with no leftover progress', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'right', speed: SPEED });

    mover.requestMove('right');
    mover.update(STEP_TIME);

    expect(mover.moving).toBe(false);
    expect(mover.progress).toBe(0);
    expect(mover.tile).toEqual({ x: 1, y: 0 });
  });

  it('reports linear progress mid-step via renderPosition', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'right', speed: SPEED });

    mover.requestMove('right');
    mover.update(STEP_TIME / 2);

    expect(mover.moving).toBe(true);
    expect(mover.progress).toBeCloseTo(0.5);
    expect(mover.renderPosition.x).toBeCloseTo(0.5);
    expect(mover.renderPosition.y).toBeCloseTo(0);
    // Tile itself does not change until the step completes.
    expect(mover.tile).toEqual({ x: 0, y: 0 });
  });

  it('produces the same logical position regardless of how dt is chopped into frames (no drift)', () => {
    // 2.5 tiles worth of continuous holding -- deliberately not an exact
    // tile-boundary multiple, so the comparison isn't sensitive to whether
    // one side happens to land a frame boundary exactly on a step edge.
    const totalTime = STEP_TIME * 2.5;

    const coarse = new GridMover({ x: 0, y: 0, facing: 'right', speed: SPEED });
    coarse.requestMove('right');
    coarse.update(totalTime);

    const fine = new GridMover({ x: 0, y: 0, facing: 'right', speed: SPEED });
    const frames = 250;
    const dtPerFrame = totalTime / frames;
    for (let i = 0; i < frames; i++) {
      fine.requestMove('right');
      fine.update(dtPerFrame);
    }

    // "Logical position" folds the completed tiles and the in-progress
    // fraction of the active step into one continuous number, so a step
    // that finished a hair early/late on one side (a boundary artifact of
    // how dt happened to be sliced) doesn't look like real drift.
    const logicalPosition = (mover: GridMover): number => mover.tile.x + mover.progress;

    expect(logicalPosition(fine)).toBeCloseTo(logicalPosition(coarse), 6);
  });

  it('chains multiple steps within a single long update() without losing time', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'right', speed: SPEED });

    mover.requestMove('right');
    mover.update(STEP_TIME * 3.5); // 3 full tiles plus half a tile

    expect(mover.tile).toEqual({ x: 3, y: 0 });
    expect(mover.moving).toBe(true);
    expect(mover.progress).toBeCloseTo(0.5);
  });
});

describe('GridMover (holding a direction chains steps across frames)', () => {
  it('keeps moving tile-by-tile while the direction keeps being requested', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'down', speed: SPEED });

    mover.requestMove('down');
    mover.update(STEP_TIME); // (0,0) -> (0,1), already facing down: moves immediately
    mover.requestMove('down');
    mover.update(STEP_TIME); // (0,1) -> (0,2)
    mover.requestMove('down');
    mover.update(STEP_TIME); // (0,2) -> (0,3)

    expect(mover.tile).toEqual({ x: 0, y: 3 });
  });

  it('stops advancing once the direction is no longer requested after the current step finishes', () => {
    const mover = new GridMover({ x: 0, y: 0, facing: 'down', speed: SPEED });

    mover.requestMove('down');
    mover.update(STEP_TIME / 2); // half-way into (0,0) -> (0,1)
    mover.update(STEP_TIME / 2); // no requestMove this frame: finishes the step, does not chain

    expect(mover.tile).toEqual({ x: 0, y: 1 });
    expect(mover.moving).toBe(false);

    mover.update(STEP_TIME);
    expect(mover.tile).toEqual({ x: 0, y: 1 });
  });
});

describe('GridMover (passability)', () => {
  it('does not move (but does turn) when canMove blocks the requested direction', () => {
    const canMove = vi.fn().mockReturnValue(false);
    const mover = new GridMover({ x: 1, y: 1, facing: 'down', speed: SPEED, canMove });

    mover.requestMove('right'); // turn
    mover.update(STEP_TIME);
    mover.requestMove('right'); // blocked attempt to move
    mover.update(STEP_TIME);

    expect(mover.facing).toBe('right');
    expect(mover.moving).toBe(false);
    expect(mover.tile).toEqual({ x: 1, y: 1 });
    expect(canMove).toHaveBeenCalledWith(1, 1, 'right');
  });

  it('moves when canMove allows the requested direction', () => {
    const canMove = vi.fn((_x: number, _y: number, _direction: Direction) => true);
    const mover = new GridMover({ x: 1, y: 1, facing: 'up', speed: SPEED, canMove });

    mover.requestMove('up');
    mover.update(STEP_TIME);

    expect(mover.tile).toEqual({ x: 1, y: 0 });
  });
});
