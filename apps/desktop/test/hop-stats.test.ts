import { describe, expect, it } from 'vitest';
import { createHopStats, recordHopCompleted } from '../src/hop-stats.js';

describe('hop-stats', () => {
  it('starts at zero hops and zero last-outgoing counts', () => {
    expect(createHopStats()).toEqual({
      hopsCompleted: 0,
      lastOutgoingNarrativeSprites: 0,
      lastOutgoingFloorTextureKeys: 0,
      lastOutgoingPropInstances: 0,
      lastOutgoingPropAssets: 0,
      lastOutgoingLights: 0,
    });
  });

  it('records each completed hop and the outgoing resource counts at dispose time', () => {
    const a = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 2,
      outgoingFloorTextureKeys: 4,
      outgoingPropInstances: 3,
      outgoingPropAssets: 1,
      outgoingLights: 5,
    });
    expect(a).toEqual({
      hopsCompleted: 1,
      lastOutgoingNarrativeSprites: 2,
      lastOutgoingFloorTextureKeys: 4,
      lastOutgoingPropInstances: 3,
      lastOutgoingPropAssets: 1,
      lastOutgoingLights: 5,
    });

    const b = recordHopCompleted(a, {
      outgoingNarrativeSprites: 1,
      outgoingFloorTextureKeys: 3,
    });
    expect(b.hopsCompleted).toBe(2);
    expect(b.lastOutgoingNarrativeSprites).toBe(1);
    expect(b.lastOutgoingFloorTextureKeys).toBe(3);
    // Omitted prop/light counters default to 0 (maps without props/lights).
    expect(b.lastOutgoingPropInstances).toBe(0);
    expect(b.lastOutgoingPropAssets).toBe(0);
    expect(b.lastOutgoingLights).toBe(0);
  });
});
