import type { TriggerDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { computeTriggerOverlayPoints } from '../src/trigger-overlay.js';

function trigger(
  overrides: Partial<TriggerDocument> & Pick<TriggerDocument, 'id'>,
): TriggerDocument {
  return {
    x: 0,
    y: 0,
    floor: 'floor-0',
    on: 'enter',
    event: 'open-gate',
    ...overrides,
  };
}

describe('computeTriggerOverlayPoints', () => {
  it('returns every trigger on the given floor', () => {
    const triggers = [
      trigger({ id: 'trigger-1', x: 1, y: 2 }),
      trigger({ id: 'trigger-2', x: 3, y: 4, floor: 'floor-1' }),
      trigger({ id: 'trigger-3', x: 5, y: 6 }),
    ];
    expect(computeTriggerOverlayPoints(triggers, 'floor-0')).toEqual([
      { id: 'trigger-1', x: 1, y: 2 },
      { id: 'trigger-3', x: 5, y: 6 },
    ]);
  });

  it('returns an empty list when no triggers sit on the floor', () => {
    expect(computeTriggerOverlayPoints([trigger({ id: 'trigger-1' })], 'floor-1')).toEqual([]);
  });
});
