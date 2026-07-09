import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/clock.js';
import { GameLoop } from '../src/game-loop.js';

/** Deterministic fake clock: advance it manually between ticks. */
class FakeClock implements Clock {
  private time = 0;
  advance(seconds: number): void {
    this.time += seconds;
  }
  now(): number {
    return this.time;
  }
}

describe('GameLoop (variable timestep)', () => {
  it('does not tick before start() is called', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const loop = new GameLoop({ clock, onTick });

    const steps = loop.tick();

    expect(steps).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('invokes onTick once per tick() with the actual elapsed time', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const loop = new GameLoop({ clock, onTick });
    loop.start();

    clock.advance(0.1);
    loop.tick();
    clock.advance(0.2);
    loop.tick();

    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls[0]?.[0]).toBeCloseTo(0.1);
    expect(onTick.mock.calls[1]?.[0]).toBeCloseTo(0.2);
  });

  it('clamps elapsed time to maxDelta to avoid a spiral of death', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const loop = new GameLoop({ clock, onTick, maxDelta: 0.25 });
    loop.start();

    clock.advance(5); // simulate a long stall
    loop.tick();

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith(0.25);
  });

  it('stop() halts ticking until start() is called again', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const loop = new GameLoop({ clock, onTick });
    loop.start();
    loop.stop();

    clock.advance(1);
    const steps = loop.tick();

    expect(steps).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });
});

describe('GameLoop (fixed timestep)', () => {
  it('runs zero steps when less than one fixed step has elapsed', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const loop = new GameLoop({ clock, onTick, fixedStep: 1 / 60 });
    loop.start();

    clock.advance(1 / 120);
    const steps = loop.tick();

    expect(steps).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('catches up with multiple fixed steps when a lot of time elapsed', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const fixedStep = 1 / 60;
    const loop = new GameLoop({ clock, onTick, fixedStep, maxDelta: 1 });
    loop.start();

    clock.advance(3 * fixedStep);
    const steps = loop.tick();

    expect(steps).toBe(3);
    expect(onTick).toHaveBeenCalledTimes(3);
    for (const call of onTick.mock.calls) {
      expect(call[0]).toBeCloseTo(fixedStep);
    }
  });

  it('carries the remainder in the accumulator across ticks', () => {
    const clock = new FakeClock();
    const onTick = vi.fn();
    const fixedStep = 1 / 60;
    const loop = new GameLoop({ clock, onTick, fixedStep, maxDelta: 1 });
    loop.start();

    clock.advance(1.5 * fixedStep);
    loop.tick(); // 1 step, 0.5 step left over
    clock.advance(0.5 * fixedStep);
    const steps = loop.tick(); // remainder + new time = 1 full step

    expect(steps).toBe(1);
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});
