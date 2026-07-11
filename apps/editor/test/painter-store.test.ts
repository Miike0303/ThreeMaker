import type { TileLayerSet } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  createPainterState,
  pointerDown,
  pointerMove,
  pointerUp,
  redo,
  setActiveLayer,
  setFillTileId,
  setTool,
  undo,
} from '../src/painter-store.js';

function makeLayers(width: number, height: number): TileLayerSet {
  const size = width * height;
  return [
    new Array(size).fill(0),
    new Array(size).fill(0),
    new Array(size).fill(0),
    new Array(size).fill(0),
  ];
}

describe('painter-store: brush', () => {
  it('paints a single cell on pointerdown + pointerup with no movement', () => {
    let state = createPainterState(makeLayers(4, 4), 4, 4, 7);
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    const result = pointerUp(state);

    expect(result.diff).toEqual({ layer: 0, cells: [{ x: 1, y: 1, before: 0, after: 7 }] });
    expect(result.state.layers[0]?.[1 * 4 + 1]).toBe(7);
    expect(result.state.commandStack.undoStack).toHaveLength(1);
  });

  it('paints every distinct cell dragged over in one stroke', () => {
    let state = createPainterState(makeLayers(4, 4), 4, 4, 5);
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    state = pointerMove(state, { x: 1, y: 0 });
    state = pointerMove(state, { x: 2, y: 0 });
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(3);
    expect(result.state.layers[0]).toEqual([5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('produces no diff (and no undo entry) when filling with the value already there', () => {
    let state = createPainterState(makeLayers(2, 2), 2, 2, 0); // fillTileId 0, cells already 0
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff).toBeUndefined();
    expect(result.state.commandStack.undoStack).toHaveLength(0);
  });

  it('pointerup while idle is a safe no-op', () => {
    const state = createPainterState(makeLayers(2, 2), 2, 2, 1);
    const result = pointerUp(state);
    expect(result.diff).toBeUndefined();
    expect(result.state).toBe(state);
  });
});

describe('painter-store: box-fill', () => {
  it('fills the rectangle between the start and end points, inclusive', () => {
    let state = createPainterState(makeLayers(5, 5), 5, 5, 9);
    state = setTool(state, 'box-fill');
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    state = pointerMove(state, { x: 3, y: 2 });
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(3 * 2); // 3 cols x 2 rows
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(result.state.layers[0]?.[y * 5 + x]).toBe(9);
      }
    }
    // Outside the rect stays untouched.
    expect(result.state.layers[0]?.[0]).toBe(0);
  });

  it('handles a box drawn in any drag direction (end above/left of start)', () => {
    let state = createPainterState(makeLayers(5, 5), 5, 5, 3);
    state = setTool(state, 'box-fill');
    ({ state } = pointerDown(state, { x: 3, y: 3 }));
    state = pointerMove(state, { x: 1, y: 1 });
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(3 * 3);
  });
});

describe('painter-store: flood-fill', () => {
  it('fills every 4-connected cell matching the origin cell value', () => {
    const layers = makeLayers(5, 5);
    // A 2x2 block of value 1 at (0,0)-(1,1), rest 0.
    const layer0 = layers[0].slice();
    layer0[0] = 1;
    layer0[1] = 1;
    layer0[5] = 1;
    layer0[6] = 1;
    const seeded: TileLayerSet = [layer0, layers[1], layers[2], layers[3]];

    let state = createPainterState(seeded, 5, 5, 8);
    state = setTool(state, 'flood-fill');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(4);
    expect(result.state.layers[0]?.slice(0, 2)).toEqual([8, 8]);
    expect(result.state.layers[0]?.slice(5, 7)).toEqual([8, 8]);
    // Cell (2,0), value 0, is NOT connected-same-value to the seeded block.
    expect(result.state.layers[0]?.[2]).toBe(0);
  });

  it('does not cross a different-value boundary', () => {
    const layers = makeLayers(3, 1);
    const layer0 = [1, 2, 1];
    const seeded: TileLayerSet = [layer0, layers[1], layers[2], layers[3]];

    let state = createPainterState(seeded, 3, 1, 9);
    state = setTool(state, 'flood-fill');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff?.cells).toEqual([{ x: 0, y: 0, before: 1, after: 9 }]);
  });
});

describe('painter-store: eyedropper', () => {
  it('picks the active layer tile id at the clicked cell without starting a stroke', () => {
    const layers = makeLayers(2, 2);
    const layer0 = layers[0].slice();
    layer0[3] = 42;
    const seeded: TileLayerSet = [layer0, layers[1], layers[2], layers[3]];

    let state = createPainterState(seeded, 2, 2, 0);
    state = setTool(state, 'eyedropper');
    const { state: nextState, pickedTileId } = pointerDown(state, { x: 1, y: 1 });

    expect(pickedTileId).toBe(42);
    expect(nextState.stroke).toEqual({ status: 'idle' });
  });
});

describe('painter-store: setTool/setActiveLayer guard mid-stroke', () => {
  it('ignores a tool switch while a stroke is in progress', () => {
    let state = createPainterState(makeLayers(3, 3), 3, 3, 1);
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = setTool(state, 'flood-fill');
    expect(switched).toBe(state);
  });

  it('ignores an active-layer switch while a stroke is in progress', () => {
    let state = createPainterState(makeLayers(3, 3), 3, 3, 1);
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = setActiveLayer(state, 2);
    expect(switched).toBe(state);
  });
});

describe('painter-store: undo/redo integration', () => {
  it('undo reverts the most recent stroke; redo re-applies it', () => {
    let state = createPainterState(makeLayers(2, 2), 2, 2, 6);
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerUp(state));
    expect(state.layers[0]?.[0]).toBe(6);

    const undone = undo(state);
    expect(undone.state.layers[0]?.[0]).toBe(0);
    expect(undone.diff).toBeDefined();

    const redone = redo(undone.state);
    expect(redone.state.layers[0]?.[0]).toBe(6);
  });

  it('paint 5, undo 3 -> layer reflects only the first 2 paints (spec scenario)', () => {
    let state = createPainterState(makeLayers(1, 1), 1, 1, 0);
    for (const value of [1, 2, 3, 4, 5]) {
      state = setFillTileId(state, value);
      ({ state } = pointerDown(state, { x: 0, y: 0 }));
      ({ state } = pointerUp(state));
    }
    expect(state.layers[0]?.[0]).toBe(5);

    for (let i = 0; i < 3; i++) {
      ({ state } = undo(state));
    }
    expect(state.layers[0]?.[0]).toBe(2);
  });

  it('undo/redo on a fresh store with no history is a safe no-op', () => {
    const state = createPainterState(makeLayers(2, 2), 2, 2, 1);
    expect(undo(state).diff).toBeUndefined();
    expect(redo(state).diff).toBeUndefined();
  });
});
