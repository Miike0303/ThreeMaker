import { describe, expect, it } from 'vitest';
import { WalkAnimation } from '../src/walk-animation.js';

describe('WalkAnimation', () => {
  it('shows the standing frame (column 1) while idle, regardless of elapsed time', () => {
    const anim = new WalkAnimation({ frameDuration: 0.15 });
    anim.update(10);

    expect(anim.frameColumn(false)).toBe(1);
  });

  it('starts a walk cycle at the standing frame, then steps through 1-0-1-2 while moving', () => {
    const anim = new WalkAnimation({ frameDuration: 0.1 });

    expect(anim.frameColumn(true)).toBe(1); // t=0
    anim.update(0.1);
    expect(anim.frameColumn(true)).toBe(0); // t=0.1
    anim.update(0.1);
    expect(anim.frameColumn(true)).toBe(1); // t=0.2
    anim.update(0.1);
    expect(anim.frameColumn(true)).toBe(2); // t=0.3
  });

  it('loops the pattern back to its start after a full cycle', () => {
    const anim = new WalkAnimation({ frameDuration: 0.1 });

    anim.update(0.4); // exactly one full 4-step cycle
    expect(anim.frameColumn(true)).toBe(1); // back to step 0 of the pattern
  });

  it('reset() restarts the cycle at the standing frame', () => {
    const anim = new WalkAnimation({ frameDuration: 0.1 });
    anim.update(0.35); // mid-cycle
    anim.reset();

    expect(anim.frameColumn(true)).toBe(1);
  });

  it('defaults to a 0.15s frame duration', () => {
    const anim = new WalkAnimation();
    anim.update(0.15);
    expect(anim.frameColumn(true)).toBe(0);
  });

  it('rejects a non-positive frame duration', () => {
    expect(() => new WalkAnimation({ frameDuration: 0 })).toThrow();
    expect(() => new WalkAnimation({ frameDuration: -1 })).toThrow();
  });
});
