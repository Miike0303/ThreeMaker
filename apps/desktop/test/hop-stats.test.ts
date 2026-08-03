import { describe, expect, it } from 'vitest';
import { createHopStats, recordHopCompleted } from '../src/hop-stats.js';

describe('hop-stats', () => {
  it('starts at zero hops and zero last-outgoing counts', () => {
    expect(createHopStats()).toEqual({
      hopsCompleted: 0,
      lastOutgoingNarrativeSprites: 0,
      lastOutgoingFloorTextureKeys: 0,
    });
  });

  it('records each completed hop and the outgoing resource counts at dispose time', () => {
    const a = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 2,
      outgoingFloorTextureKeys: 4,
    });
    expect(a).toEqual({
      hopsCompleted: 1,
      lastOutgoingNarrativeSprites: 2,
      lastOutgoingFloorTextureKeys: 4,
    });

    const b = recordHopCompleted(a, {
      outgoingNarrativeSprites: 1,
      outgoingFloorTextureKeys: 3,
    });
    expect(b.hopsCompleted).toBe(2);
    expect(b.lastOutgoingNarrativeSprites).toBe(1);
    expect(b.lastOutgoingFloorTextureKeys).toBe(3);
  });
});
