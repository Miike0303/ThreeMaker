import { describe, expect, it } from 'vitest';
import { painterDocumentSlicesChanged, shouldConfirmMapSwitch } from '../src/painter-dirty.js';
import {
  addEvent,
  createPainterState,
  pointerDown,
  pointerUp,
  selectFloor,
  setActiveLayer,
  setFillTileId,
  setSpawn,
  setTool,
} from '../src/painter-store.js';

function blankState() {
  const size = 4 * 4;
  return createPainterState({
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: [
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
          new Array(size).fill(0),
        ],
      },
    ],
    width: 4,
    height: 4,
    fillTileId: 7,
  });
}

describe('painterDocumentSlicesChanged (WU-UX-13)', () => {
  it('is false between identical state and after pure UI transitions', () => {
    const state = blankState();
    expect(painterDocumentSlicesChanged(state, state)).toBe(false);
    expect(painterDocumentSlicesChanged(state, setTool(state, 'flood-fill'))).toBe(false);
    expect(painterDocumentSlicesChanged(state, setActiveLayer(state, 2))).toBe(false);
    expect(painterDocumentSlicesChanged(state, setFillTileId(state, 42))).toBe(false);
    expect(painterDocumentSlicesChanged(state, selectFloor(state, 0))).toBe(false);
  });

  it('is true after a committed paint stroke', () => {
    const before = blankState();
    const { state: stroking } = pointerDown(before, { x: 1, y: 1 });
    expect(painterDocumentSlicesChanged(before, stroking)).toBe(false); // mid-stroke: not committed
    const committed = pointerUp(stroking).state;
    expect(painterDocumentSlicesChanged(stroking, committed)).toBe(true);
  });

  it('is true after entity, spawn, and event mutations', () => {
    const state = blankState();
    expect(
      painterDocumentSlicesChanged(state, setSpawn(state, { floor: 'floor-0', x: 1, y: 1 })),
    ).toBe(true);
    expect(painterDocumentSlicesChanged(state, addEvent(state, 'intro'))).toBe(true);
  });
});

describe('shouldConfirmMapSwitch', () => {
  it('confirms when a map is open and dirty', () => {
    expect(shouldConfirmMapSwitch({ mapReady: true, docDirty: true })).toBe(true);
  });

  it('does not confirm when the open map is clean', () => {
    expect(shouldConfirmMapSwitch({ mapReady: true, docDirty: false })).toBe(false);
  });

  it('does not confirm when no map is open', () => {
    expect(shouldConfirmMapSwitch({ mapReady: false, docDirty: true })).toBe(false);
    expect(shouldConfirmMapSwitch({ mapReady: false, docDirty: false })).toBe(false);
  });

  it('confirms when the map document is clean but Ink is dirty', () => {
    expect(shouldConfirmMapSwitch({ mapReady: true, docDirty: false, inkDirty: true })).toBe(true);
  });
});
