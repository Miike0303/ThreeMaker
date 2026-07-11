import { describe, expect, it } from 'vitest';
import type { StairLinkDefinition } from '../src/stair-trigger-tracker.js';
import { StairTriggerTracker } from '../src/stair-trigger-tracker.js';

const LINK: StairLinkDefinition = {
  bidirectional: true,
  waypoints: [
    { x: 2, y: 2, floor: 0 },
    { x: 4, y: 2, floor: 1 },
  ],
};

describe('StairTriggerTracker — shouldTrigger (entry, forward)', () => {
  it('fires once when the player steps onto the entry waypoint', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 0, y: 0 });

    expect(tracker.shouldTrigger({ floor: 0, x: 1, y: 2 }, [LINK])).toBeUndefined();
    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toEqual(LINK.waypoints);
  });

  it('does not re-fire while standing still on the same tile', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 0, y: 0 });

    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toEqual(LINK.waypoints);
    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toBeUndefined();
    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toBeUndefined();
  });

  it('re-fires after leaving the entry tile and re-entering it', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 0, y: 0 });

    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toEqual(LINK.waypoints);
    expect(tracker.shouldTrigger({ floor: 0, x: 3, y: 2 }, [LINK])).toBeUndefined(); // leaves
    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toEqual(LINK.waypoints); // re-enters
  });

  it('does not fire for the tile the tracker was constructed with (spawn-on-entry convention)', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 2, y: 2 });

    expect(tracker.shouldTrigger({ floor: 0, x: 2, y: 2 }, [LINK])).toBeUndefined();
  });
});

describe('StairTriggerTracker — shouldTrigger (landing, reversed/bidirectional)', () => {
  it('returns the REVERSED waypoint order when the player steps onto a bidirectional landing', () => {
    const tracker = new StairTriggerTracker({ floor: 1, x: 0, y: 0 });

    expect(tracker.shouldTrigger({ floor: 1, x: 4, y: 2 }, [LINK])).toEqual(
      [...LINK.waypoints].reverse(),
    );
  });

  it('does not fire on the landing tile when the link is not bidirectional', () => {
    const oneWay: StairLinkDefinition = { ...LINK, bidirectional: false };
    const tracker = new StairTriggerTracker({ floor: 1, x: 0, y: 0 });

    expect(tracker.shouldTrigger({ floor: 1, x: 4, y: 2 }, [oneWay])).toBeUndefined();
  });
});

describe('StairTriggerTracker — mark (completion-frame arrival, no re-trigger)', () => {
  it('a completion-frame teleport onto the landing cell does NOT fire the reverse link when recorded via mark()', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 0, y: 0 });

    // Simulates main.ts's game loop: the completion frame teleports the
    // player onto the landing tile and records the arrival via mark() --
    // never calling shouldTrigger() for that same teleport -- so the very
    // next per-tick shouldTrigger() call for the SAME tile must not re-fire
    // the reverse link, exactly like a normal on-arrival dedup.
    tracker.mark({ floor: 1, x: 4, y: 2 });

    expect(tracker.shouldTrigger({ floor: 1, x: 4, y: 2 }, [LINK])).toBeUndefined();
  });

  it('still re-fires once the player leaves the marked tile and comes back', () => {
    const tracker = new StairTriggerTracker({ floor: 0, x: 0, y: 0 });

    tracker.mark({ floor: 1, x: 4, y: 2 });
    expect(tracker.shouldTrigger({ floor: 1, x: 4, y: 2 }, [LINK])).toBeUndefined();
    expect(tracker.shouldTrigger({ floor: 1, x: 3, y: 2 }, [LINK])).toBeUndefined(); // leaves
    expect(tracker.shouldTrigger({ floor: 1, x: 4, y: 2 }, [LINK])).toEqual(
      [...LINK.waypoints].reverse(),
    ); // re-enters
  });
});
