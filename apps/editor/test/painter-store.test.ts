import type { RoomDocument, TileLayerSet } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  activeFloorState,
  addFloor,
  addRoom,
  addRoomRect,
  createPainterState,
  pointerDown,
  pointerMove,
  pointerUp,
  redo,
  redoRoom,
  removeFloor,
  removeRoom,
  removeRoomRect,
  renameRoom,
  selectFloor,
  setActiveLayer,
  setActiveRoomId,
  setFillTileId,
  setSemanticClass,
  setSemanticMode,
  setTool,
  undo,
  undoRoom,
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

/** A single-floor `createPainterState` options helper: reduces boilerplate for tests that only care about one floor (the overwhelming majority -- this is the regression-guarded, pre-Slice-4 common case). */
function oneFloor(width: number, height: number, layers?: TileLayerSet) {
  return {
    floors: [{ id: 'floor-0', baseElevation: 0, layers: layers ?? makeLayers(width, height) }],
  };
}

describe('painter-store: brush', () => {
  it('paints a single cell on pointerdown + pointerup with no movement', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      fillTileId: 7,
    });
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    const result = pointerUp(state);

    expect(result.diff).toEqual({ layer: 0, cells: [{ x: 1, y: 1, before: 0, after: 7 }] });
    expect(activeFloorState(result.state).layers[0]?.[1 * 4 + 1]).toBe(7);
    expect(activeFloorState(result.state).commandStack.undoStack).toHaveLength(1);
  });

  it('paints every distinct cell dragged over in one stroke', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      fillTileId: 5,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    state = pointerMove(state, { x: 1, y: 0 });
    state = pointerMove(state, { x: 2, y: 0 });
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(3);
    expect(activeFloorState(result.state).layers[0]).toEqual([
      5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('produces no diff (and no undo entry) when filling with the value already there', () => {
    let state = createPainterState({
      ...oneFloor(2, 2),
      width: 2,
      height: 2,
      fillTileId: 0,
    }); // fillTileId 0, cells already 0
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff).toBeUndefined();
    expect(activeFloorState(result.state).commandStack.undoStack).toHaveLength(0);
  });

  it('pointerup while idle is a safe no-op', () => {
    const state = createPainterState({
      ...oneFloor(2, 2),
      width: 2,
      height: 2,
      fillTileId: 1,
    });
    const result = pointerUp(state);
    expect(result.diff).toBeUndefined();
    expect(result.state).toBe(state);
  });
});

describe('painter-store: box-fill', () => {
  it('fills the rectangle between the start and end points, inclusive', () => {
    let state = createPainterState({
      ...oneFloor(5, 5),
      width: 5,
      height: 5,
      fillTileId: 9,
    });
    state = setTool(state, 'box-fill');
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    state = pointerMove(state, { x: 3, y: 2 });
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(3 * 2); // 3 cols x 2 rows
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(activeFloorState(result.state).layers[0]?.[y * 5 + x]).toBe(9);
      }
    }
    // Outside the rect stays untouched.
    expect(activeFloorState(result.state).layers[0]?.[0]).toBe(0);
  });

  it('handles a box drawn in any drag direction (end above/left of start)', () => {
    let state = createPainterState({
      ...oneFloor(5, 5),
      width: 5,
      height: 5,
      fillTileId: 3,
    });
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

    let state = createPainterState({
      ...oneFloor(5, 5, seeded),
      width: 5,
      height: 5,
      fillTileId: 8,
    });
    state = setTool(state, 'flood-fill');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff?.cells).toHaveLength(4);
    expect(activeFloorState(result.state).layers[0]?.slice(0, 2)).toEqual([8, 8]);
    expect(activeFloorState(result.state).layers[0]?.slice(5, 7)).toEqual([8, 8]);
    // Cell (2,0), value 0, is NOT connected-same-value to the seeded block.
    expect(activeFloorState(result.state).layers[0]?.[2]).toBe(0);
  });

  it('does not cross a different-value boundary', () => {
    const layers = makeLayers(3, 1);
    const layer0 = [1, 2, 1];
    const seeded: TileLayerSet = [layer0, layers[1], layers[2], layers[3]];

    let state = createPainterState({
      ...oneFloor(3, 1, seeded),
      width: 3,
      height: 1,
      fillTileId: 9,
    });
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

    let state = createPainterState({
      ...oneFloor(2, 2, seeded),
      width: 2,
      height: 2,
      fillTileId: 0,
    });
    state = setTool(state, 'eyedropper');
    const { state: nextState, pickedTileId } = pointerDown(state, { x: 1, y: 1 });

    expect(pickedTileId).toBe(42);
    expect(nextState.stroke).toEqual({ status: 'idle' });
  });
});

describe('painter-store: setTool/setActiveLayer guard mid-stroke', () => {
  it('ignores a tool switch while a stroke is in progress', () => {
    let state = createPainterState({
      ...oneFloor(3, 3),
      width: 3,
      height: 3,
      fillTileId: 1,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = setTool(state, 'flood-fill');
    expect(switched).toBe(state);
  });

  it('ignores an active-layer switch while a stroke is in progress', () => {
    let state = createPainterState({
      ...oneFloor(3, 3),
      width: 3,
      height: 3,
      fillTileId: 1,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = setActiveLayer(state, 2);
    expect(switched).toBe(state);
  });
});

describe('painter-store: undo/redo integration', () => {
  it('undo reverts the most recent stroke; redo re-applies it', () => {
    let state = createPainterState({
      ...oneFloor(2, 2),
      width: 2,
      height: 2,
      fillTileId: 6,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerUp(state));
    expect(activeFloorState(state).layers[0]?.[0]).toBe(6);

    const undone = undo(state);
    expect(activeFloorState(undone.state).layers[0]?.[0]).toBe(0);
    expect(undone.diff).toBeDefined();

    const redone = redo(undone.state);
    expect(activeFloorState(redone.state).layers[0]?.[0]).toBe(6);
  });

  it('paint 5, undo 3 -> layer reflects only the first 2 paints (spec scenario)', () => {
    let state = createPainterState({
      ...oneFloor(1, 1),
      width: 1,
      height: 1,
      fillTileId: 0,
    });
    for (const value of [1, 2, 3, 4, 5]) {
      state = setFillTileId(state, value);
      ({ state } = pointerDown(state, { x: 0, y: 0 }));
      ({ state } = pointerUp(state));
    }
    expect(activeFloorState(state).layers[0]?.[0]).toBe(5);

    for (let i = 0; i < 3; i++) {
      ({ state } = undo(state));
    }
    expect(activeFloorState(state).layers[0]?.[0]).toBe(2);
  });

  it('undo/redo on a fresh store with no history is a safe no-op', () => {
    const state = createPainterState({
      ...oneFloor(2, 2),
      width: 2,
      height: 2,
      fillTileId: 1,
    });
    expect(undo(state).diff).toBeUndefined();
    expect(redo(state).diff).toBeUndefined();
  });
});

describe('painter-store: semantic-class mode (spec: "Semantic-only edit")', () => {
  it('assigns the active class to the touched tile id without altering the visual tile layer', () => {
    const layers = makeLayers(2, 2);
    const layer0 = layers[0].slice();
    layer0[0] = 5; // some existing painted tile
    const seeded: TileLayerSet = [layer0, layers[1], layers[2], layers[3]];

    let state = createPainterState({
      ...oneFloor(2, 2, seeded),
      width: 2,
      height: 2,
      fillTileId: 9,
    }); // fillTileId=9 must be IGNORED in semantic mode
    state = setSemanticMode(state, true);
    state = setSemanticClass(state, 'door');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.diff).toBeUndefined(); // no tile-layer diff
    expect(result.semanticTileIds).toEqual(new Set([5]));
    expect(activeFloorState(result.state).layers[0]?.[0]).toBe(5); // visual tile UNCHANGED
    expect(result.state.semantics['5']).toEqual({ class: 'door' });
    expect(activeFloorState(result.state).commandStack.undoStack).toHaveLength(0); // not part of tile undo history
  });

  it('produces no assignment when the stroke only touches empty (id 0) cells', () => {
    let state = createPainterState({
      ...oneFloor(2, 2),
      width: 2,
      height: 2,
      fillTileId: 1,
    });
    state = setSemanticMode(state, true);
    state = setSemanticClass(state, 'wall');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);

    expect(result.semanticTileIds).toBeUndefined();
    expect(result.state.semantics).toEqual({});
  });

  it('setSemanticMode/setSemanticClass are ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({
      ...oneFloor(3, 3),
      width: 3,
      height: 3,
      fillTileId: 1,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = setSemanticMode(state, true);
    expect(switched).toBe(state);
  });
});

describe('painter-store: floor switcher (Slice 4 -- painter-floors spec)', () => {
  it('createPainterState defaults activeFloor to 0 on a single-floor init', () => {
    const state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    expect(state.activeFloor).toBe(0);
    expect(state.floors).toHaveLength(1);
  });

  it('addFloor appends a new blank floor at baseElevation = prev + DEFAULT_FLOOR_HEIGHT and makes it active (spec: "adding a floor")', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    state = addFloor(state, { id: 'floor-1' });

    expect(state.floors).toHaveLength(2);
    expect(state.activeFloor).toBe(1);
    expect(state.floors[1]).toMatchObject({ id: 'floor-1', baseElevation: 3 });
    expect(state.floors[1]?.layers[0]).toEqual([0, 0, 0, 0]);
    expect(state.floors[1]?.commandStack.undoStack).toHaveLength(0);
    // floor 0 completely untouched by adding floor 1.
    expect(state.floors[0]).toMatchObject({ id: 'floor-0', baseElevation: 0 });
  });

  it('addFloor stacks baseElevation from the topmost floor, not the active one', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    state = addFloor(state, { id: 'floor-1' }); // baseElevation 3, now active
    state = selectFloor(state, 0); // switch back to floor-0
    state = addFloor(state, { id: 'floor-2' }); // should stack on TOP floor (floor-1, elevation 3), not the active floor-0

    expect(state.floors).toHaveLength(3);
    expect(state.floors[2]).toMatchObject({ id: 'floor-2', baseElevation: 6 });
    expect(state.activeFloor).toBe(2);
  });

  it('addFloor is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2, fillTileId: 1 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = addFloor(state, { id: 'floor-1' });
    expect(switched).toBe(state);
  });

  it('selectFloor switches the active floor', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    state = addFloor(state, { id: 'floor-1' });
    state = selectFloor(state, 0);
    expect(state.activeFloor).toBe(0);
  });

  it('selectFloor with an out-of-range index is a safe no-op', () => {
    const state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    expect(selectFloor(state, 5)).toBe(state);
    expect(selectFloor(state, -1)).toBe(state);
  });

  it('selectFloor is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2, fillTileId: 1 });
    state = addFloor(state, { id: 'floor-1' });
    state = selectFloor(state, 0);
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = selectFloor(state, 1);
    expect(switched).toBe(state);
  });

  it('painting floor 1 leaves floor 0 completely untouched (spec: "editing the active floor only")', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2, fillTileId: 7 });
    state = addFloor(state, { id: 'floor-1' }); // now active
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerUp(state));

    expect(state.floors[1]?.layers[0]?.[0]).toBe(7);
    expect(state.floors[0]?.layers[0]?.[0]).toBe(0);
  });

  it('undo routes to the active floors own stack, never a different floors (spec: "per-floor undo isolation")', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2, fillTileId: 4 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerUp(state)); // floor 0 painted, 1 undo entry

    state = addFloor(state, { id: 'floor-1' });
    state = setFillTileId(state, 9);
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    ({ state } = pointerUp(state)); // floor 1 painted, its own 1 undo entry

    expect(state.floors[0]?.commandStack.undoStack).toHaveLength(1);
    expect(state.floors[1]?.commandStack.undoStack).toHaveLength(1);

    // Undo while floor 1 is active must only affect floor 1.
    ({ state } = undo(state));
    expect(state.floors[1]?.layers[0]?.[1 * 2 + 1]).toBe(0);
    expect(state.floors[1]?.commandStack.undoStack).toHaveLength(0);
    // Floor 0's paint and undo stack are untouched.
    expect(state.floors[0]?.layers[0]?.[0]).toBe(4);
    expect(state.floors[0]?.commandStack.undoStack).toHaveLength(1);

    // Switching back to floor 0 and undoing now affects floor 0's own stack.
    state = selectFloor(state, 0);
    ({ state } = undo(state));
    expect(state.floors[0]?.layers[0]?.[0]).toBe(0);
    expect(state.floors[0]?.commandStack.undoStack).toHaveLength(0);
  });

  it('removeFloor drops the given floor and re-clamps activeFloor', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    state = addFloor(state, { id: 'floor-1' });
    state = addFloor(state, { id: 'floor-2' }); // active = 2

    state = removeFloor(state, 1); // remove the middle floor while active points past it
    expect(state.floors.map((f) => f.id)).toEqual(['floor-0', 'floor-2']);
    expect(state.activeFloor).toBe(1); // shifted down by 1 (was 2, one removed before it)
  });

  it('removeFloor re-clamps activeFloor when the ACTIVE floor itself is removed', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    state = addFloor(state, { id: 'floor-1' }); // active = 1
    state = removeFloor(state, 1); // remove the active floor itself (the last one)

    expect(state.floors.map((f) => f.id)).toEqual(['floor-0']);
    expect(state.activeFloor).toBe(0);
  });

  it('removeFloor refuses to drop the last remaining floor (min 1 enforced)', () => {
    const state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2 });
    const result = removeFloor(state, 0);
    expect(result).toBe(state);
    expect(result.floors).toHaveLength(1);
  });

  it('removeFloor is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(2, 2), width: 2, height: 2, fillTileId: 1 });
    state = addFloor(state, { id: 'floor-1' });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const switched = removeFloor(state, 1);
    expect(switched).toBe(state);
  });

  it('createPainterState accepts a multi-floor init with an explicit activeFloor (map load path)', () => {
    const state = createPainterState({
      floors: [
        { id: 'floor-0', baseElevation: 0, layers: makeLayers(2, 2) },
        { id: 'floor-1', label: 'Roof', baseElevation: 3, layers: makeLayers(2, 2) },
      ],
      width: 2,
      height: 2,
      activeFloor: 1,
    });
    expect(state.floors).toHaveLength(2);
    expect(state.activeFloor).toBe(1);
    expect(state.floors[1]).toMatchObject({ label: 'Roof', baseElevation: 3 });
    // Each floor gets its own fresh command stack regardless of source doc.
    expect(state.floors[0]?.commandStack.undoStack).toHaveLength(0);
    expect(state.floors[1]?.commandStack.undoStack).toHaveLength(0);
  });
});

describe('painter-store: room CRUD + per-floor undo (Slice 5a -- techos-y-oclusion-interiores)', () => {
  it('createPainterState defaults rooms to an empty array', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(state.rooms).toEqual([]);
  });

  it('createPainterState accepts an initial rooms array (map load path)', () => {
    const rooms: readonly RoomDocument[] = [
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 2, height: 2 }] },
    ];
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, rooms });
    expect(state.rooms).toEqual(rooms);
  });

  it('addRoom adds a room to state.rooms, referencing the active floor by id', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 2, height: 2 }] });

    expect(state.rooms).toEqual([
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 2, height: 2 }] },
    ]);
  });

  it('addRoom carries an optional name', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, {
      id: 'room-1',
      name: 'Library',
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    });
    expect(state.rooms[0]).toMatchObject({ name: 'Library' });
  });

  it('addRoom is a no-op if a room with that id already exists on the active floor', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    const result = addRoom(state, { id: 'room-1', rects: [{ x: 2, y: 2, width: 1, height: 1 }] });
    expect(result).toBe(state);
  });

  it('addRoom is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 1 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    expect(result).toBe(state);
  });

  it('removeRoom removes the room from state.rooms', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    state = removeRoom(state, 'room-1');
    expect(state.rooms).toEqual([]);
  });

  it('removeRoom is a safe no-op when no room with that id exists on the active floor', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    const result = removeRoom(state, 'nope');
    expect(result).toBe(state);
  });

  it('renameRoom updates the room name without touching its rects', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    state = renameRoom(state, 'room-1', 'Library');
    expect(state.rooms[0]).toMatchObject({
      name: 'Library',
      rects: [{ x: 0, y: 0, width: 1, height: 1 }],
    });
  });

  it('renameRoom(undefined) clears an existing name', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, {
      id: 'room-1',
      name: 'Library',
      rects: [{ x: 0, y: 0, width: 1, height: 1 }],
    });
    state = renameRoom(state, 'room-1', undefined);
    expect(state.rooms[0]?.name).toBeUndefined();
  });

  it('renameRoom is a safe no-op for an unknown room id', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(renameRoom(state, 'nope', 'x')).toBe(state);
  });

  it('addRoomRect appends a rect to an existing room', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    state = addRoomRect(state, 'room-1', { x: 2, y: 2, width: 1, height: 1 });
    expect(state.rooms[0]?.rects).toEqual([
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 2, y: 2, width: 1, height: 1 },
    ]);
  });

  it('removeRoomRect removes the given rect', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, {
      id: 'room-1',
      rects: [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 2, y: 2, width: 1, height: 1 },
      ],
    });
    state = removeRoomRect(state, 'room-1', 0);
    expect(state.rooms[0]?.rects).toEqual([{ x: 2, y: 2, width: 1, height: 1 }]);
  });

  it('removeRoomRect refuses to leave a room with zero rects', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    const result = removeRoomRect(state, 'room-1', 0);
    expect(result).toBe(state);
    expect(result.rooms[0]?.rects).toHaveLength(1);
  });

  it('undoRoom reverts the most recent room command; redoRoom re-applies it', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    expect(state.rooms).toHaveLength(1);

    const undone = undoRoom(state);
    expect(undone.state.rooms).toEqual([]);
    expect(undone.command).toBeDefined();

    const redone = redoRoom(undone.state);
    expect(redone.state.rooms).toHaveLength(1);
  });

  it('undoRoom/redoRoom on a fresh store with no room history is a safe no-op', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(undoRoom(state).command).toBeUndefined();
    expect(redoRoom(state).command).toBeUndefined();
  });

  it('undo routes to the active floor its own room-command stack, never a different floor (spec: "per-floor undo isolation")', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-a', rects: [{ x: 0, y: 0, width: 1, height: 1 }] }); // floor 0

    state = addFloor(state, { id: 'floor-1' }); // now active
    state = addRoom(state, { id: 'room-b', rects: [{ x: 1, y: 1, width: 1, height: 1 }] }); // floor 1

    expect(state.rooms).toHaveLength(2);

    // Undo while floor 1 is active must only affect floor 1's room.
    state = undoRoom(state).state;
    expect(state.rooms).toEqual([
      { id: 'room-a', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ]);

    // Switching back to floor 0 and undoing now affects floor 0's own room command.
    state = selectFloor(state, 0);
    state = undoRoom(state).state;
    expect(state.rooms).toEqual([]);
  });

  it('rooms authored on one floor do not leak onto another floor', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] }); // floor-0
    state = addFloor(state, { id: 'floor-1' });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 1, y: 1, width: 1, height: 1 }] }); // same id, floor-1 -- allowed (per-floor unique ids)

    expect(state.rooms).toEqual([
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
      { id: 'room-1', floor: 'floor-1', rects: [{ x: 1, y: 1, width: 1, height: 1 }] },
    ]);
  });
});

describe('painter-store: room-box tool (Slice 5b -- techos-y-oclusion-interiores)', () => {
  it('setActiveRoomId sets/clears the room the next room-box stroke extends', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(state.activeRoomId).toBeUndefined();

    state = setActiveRoomId(state, 'room-1');
    expect(state.activeRoomId).toBe('room-1');

    state = setActiveRoomId(state, undefined);
    expect(state.activeRoomId).toBeUndefined();
  });

  it('setActiveRoomId is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = setActiveRoomId(state, 'room-1');
    expect(result).toBe(state);
  });

  it('pointerUp on a room-box stroke creates a new room from the drag bounds using the caller-supplied newRoomId', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'room-box');
    ({ state } = pointerDown(state, { x: 1, y: 1 }));
    state = pointerMove(state, { x: 3, y: 3 });
    const result = pointerUp(state, { newRoomId: 'room-1' });

    expect(result.state.rooms).toEqual([
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 1, y: 1, width: 3, height: 3 }] },
    ]);
    expect(result.state.stroke).toEqual({ status: 'idle' });
    // Continuous authoring: the newly created room becomes the active room,
    // so the NEXT room-box drag extends it instead of creating another one.
    expect(result.state.activeRoomId).toBe('room-1');
  });

  it('pointerUp on a room-box stroke with no movement still creates a 1x1 room rect', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'room-box');
    ({ state } = pointerDown(state, { x: 2, y: 2 }));
    const result = pointerUp(state, { newRoomId: 'room-1' });
    expect(result.state.rooms[0]?.rects).toEqual([{ x: 2, y: 2, width: 1, height: 1 }]);
  });

  it('pointerUp on a room-box stroke with no active room and no newRoomId is a safe no-op', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'room-box');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state);
    expect(result.state.rooms).toEqual([]);
    expect(result.state.stroke).toEqual({ status: 'idle' });
  });

  it('pointerUp on a room-box stroke while an existing room is active extends it via addRoomRect, ignoring newRoomId', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addRoom(state, { id: 'room-1', rects: [{ x: 0, y: 0, width: 1, height: 1 }] });
    state = setActiveRoomId(state, 'room-1');
    state = setTool(state, 'room-box');
    ({ state } = pointerDown(state, { x: 2, y: 2 }));
    const result = pointerUp(state, { newRoomId: 'room-should-be-ignored' });

    expect(result.state.rooms).toEqual([
      {
        id: 'room-1',
        floor: 'floor-0',
        rects: [
          { x: 0, y: 0, width: 1, height: 1 },
          { x: 2, y: 2, width: 1, height: 1 },
        ],
      },
    ]);
  });

  it('pointerUp on a room-box stroke ignores an activeRoomId that does not exist on the active floor and creates a new room instead', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActiveRoomId(state, 'ghost-room');
    state = setTool(state, 'room-box');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = pointerUp(state, { newRoomId: 'room-1' });

    expect(result.state.rooms).toEqual([
      { id: 'room-1', floor: 'floor-0', rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
    ]);
  });

  it('a room op and a tile paint on the same floor keep fully separate undo histories (5a-gate follow-up)', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 5 });

    // Tile paint first.
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerUp(state));
    expect(activeFloorState(state).commandStack.undoStack).toHaveLength(1);
    expect(activeFloorState(state).roomCommandStack.undoStack).toHaveLength(0);

    // Room op.
    state = addRoom(state, { id: 'room-1', rects: [{ x: 1, y: 1, width: 1, height: 1 }] });
    expect(activeFloorState(state).roomCommandStack.undoStack).toHaveLength(1);
    expect(activeFloorState(state).commandStack.undoStack).toHaveLength(1);

    // undoRoom must revert only the room, leaving the tile commandStack (and the painted tile) alone.
    state = undoRoom(state).state;
    expect(state.rooms).toEqual([]);
    expect(activeFloorState(state).commandStack.undoStack).toHaveLength(1);
    expect(activeFloorState(state).layers[0]?.[0]).toBe(5);

    // Redo the room back so the next assertion has both a room and a painted tile again.
    state = redoRoom(state).state;
    expect(state.rooms).toHaveLength(1);

    // undo (tile) must revert only the tile paint, leaving the roomCommandStack (and the room) alone.
    ({ state } = undo(state));
    expect(activeFloorState(state).layers[0]?.[0]).toBe(0);
    expect(activeFloorState(state).roomCommandStack.undoStack).toHaveLength(1);
    expect(state.rooms).toHaveLength(1);
  });
});
