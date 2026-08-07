import type { RoomDocument, TileLayerSet } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  activeFloorState,
  addCommand,
  addEvent,
  addFloor,
  addRoom,
  addRoomRect,
  addStairLink,
  clearSpawn,
  createPainterState,
  moveCommand,
  nextNpcId,
  nextPropId,
  nextTriggerId,
  placeNpc,
  placeNpcAtTile,
  placeProp,
  placePropAtTile,
  placeTrigger,
  placeTriggerAtTile,
  pointerDown,
  pointerMove,
  pointerUp,
  redo,
  redoNpc,
  redoProp,
  redoRoom,
  redoTrigger,
  removeCommand,
  removeEvent,
  removeFloor,
  removeNpc,
  removeProp,
  removeRoom,
  removeRoomRect,
  removeStairLink,
  removeTrigger,
  removeWorldSeed,
  renameEvent,
  renameRoom,
  selectFloor,
  setActiveLayer,
  setActiveNpcCharacterIndex,
  setActiveNpcEventKey,
  setActiveNpcFacing,
  setActiveNpcSpriteObject,
  setActivePropObject,
  setActiveRoomId,
  setActiveTriggerEventKey,
  setActiveTriggerOn,
  setFillTileId,
  setPendingStairEntry,
  setSemanticClass,
  setSemanticMode,
  setSpawn,
  setTool,
  setWorldSeed,
  toggleStairLinkBidirectional,
  undo,
  undoNpc,
  undoProp,
  undoRoom,
  undoTrigger,
  updateCommand,
  validateEventsDraft,
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

describe('painter-store: setTool/setActiveLayer mid-stroke', () => {
  it('cancels a stuck stroke and switches tool (live editor resilience)', () => {
    let state = createPainterState({
      ...oneFloor(3, 3),
      width: 3,
      height: 3,
      fillTileId: 1,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    expect(state.stroke.status).toBe('stroking');
    const switched = setTool(state, 'flood-fill');
    expect(switched.stroke).toEqual({ status: 'idle' });
    expect(switched.tool).toBe('flood-fill');
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

describe('painter-store: stair-link authoring (Slice 5a -- loop-crear-jugar)', () => {
  it('createPainterState defaults stairLinks to an empty array', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(state.stairLinks).toEqual([]);
  });

  it('createPainterState accepts an initial stairLinks array (map load path)', () => {
    const stairLinks = [
      {
        id: 'stair-1',
        fromFloor: 'floor-0',
        toFloor: 'floor-1',
        bidirectional: true,
        waypoints: [
          { x: 0, y: 0, floor: 'floor-0' },
          { x: 1, y: 1, floor: 'floor-1' },
        ],
      },
    ];
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      stairLinks,
    });
    expect(state.stairLinks).toEqual(stairLinks);
  });

  it('addStairLink appends a 2-waypoint StairLinkDocument from entry/exit tiles, defaulting bidirectional to true', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 2, y: 3 },
      exit: { x: 0, y: 0 },
    });

    expect(state.stairLinks).toEqual([
      {
        id: 'stair-1',
        fromFloor: 'floor-0',
        toFloor: 'floor-1',
        bidirectional: true,
        waypoints: [
          { x: 2, y: 3, floor: 'floor-0' },
          { x: 0, y: 0, floor: 'floor-1' },
        ],
      },
    ]);
  });

  it('addStairLink honors an explicit bidirectional: false', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
      bidirectional: false,
    });
    expect(state.stairLinks[0]?.bidirectional).toBe(false);
  });

  it('addStairLink is a no-op if a link with that id already exists', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    const result = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 2, y: 2 },
      exit: { x: 3, y: 3 },
    });
    expect(result).toBe(state);
  });

  it('addStairLink is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 1 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    expect(result).toBe(state);
  });

  it('removeStairLink removes the link from state.stairLinks', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    state = removeStairLink(state, 'stair-1');
    expect(state.stairLinks).toEqual([]);
  });

  it('removeStairLink is a safe no-op for an unknown id', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    const result = removeStairLink(state, 'nope');
    expect(result).toBe(state);
  });

  it('removeStairLink is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 1 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = removeStairLink(state, 'stair-1');
    expect(result).toBe(state);
  });

  it('toggleStairLinkBidirectional flips the flag on the matching link', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    expect(state.stairLinks[0]?.bidirectional).toBe(true);

    state = toggleStairLinkBidirectional(state, 'stair-1');
    expect(state.stairLinks[0]?.bidirectional).toBe(false);

    state = toggleStairLinkBidirectional(state, 'stair-1');
    expect(state.stairLinks[0]?.bidirectional).toBe(true);
  });

  it('toggleStairLinkBidirectional is a safe no-op for an unknown id', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    const result = toggleStairLinkBidirectional(state, 'nope');
    expect(result).toBe(state);
  });

  it('toggleStairLinkBidirectional is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 1 });
    state = addStairLink(state, {
      id: 'stair-1',
      fromFloor: 'floor-0',
      toFloor: 'floor-1',
      entry: { x: 0, y: 0 },
      exit: { x: 1, y: 1 },
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = toggleStairLinkBidirectional(state, 'stair-1');
    expect(result).toBe(state);
  });

  it('setPendingStairEntry sets/clears the pending entry point for the 2-click stair-link flow', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(state.pendingStairEntry).toBeUndefined();

    state = setPendingStairEntry(state, { floor: 'floor-0', x: 1, y: 2 });
    expect(state.pendingStairEntry).toEqual({ floor: 'floor-0', x: 1, y: 2 });

    state = setPendingStairEntry(state, undefined);
    expect(state.pendingStairEntry).toBeUndefined();
  });

  it('setPendingStairEntry is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = setPendingStairEntry(state, { floor: 'floor-0', x: 1, y: 2 });
    expect(result).toBe(state);
  });
});

describe('painter-store: spawn authoring (Slice 5a -- loop-crear-jugar)', () => {
  it('createPainterState defaults spawn to undefined', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    expect(state.spawn).toBeUndefined();
  });

  it('createPainterState accepts an initial spawn (map load path)', () => {
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      spawn: { x: 2, y: 2, floor: 'floor-0' },
    });
    expect(state.spawn).toEqual({ x: 2, y: 2, floor: 'floor-0' });
  });

  it('setSpawn sets the spawn point', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setSpawn(state, { x: 1, y: 1, floor: 'floor-0' });
    expect(state.spawn).toEqual({ x: 1, y: 1, floor: 'floor-0' });
  });

  it('setSpawn replaces an existing spawn (single spawn per map)', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      spawn: { x: 0, y: 0, floor: 'floor-0' },
    });
    state = setSpawn(state, { x: 3, y: 3, floor: 'floor-0' });
    expect(state.spawn).toEqual({ x: 3, y: 3, floor: 'floor-0' });
  });

  it('setSpawn is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4, fillTileId: 1 });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = setSpawn(state, { x: 1, y: 1, floor: 'floor-0' });
    expect(result).toBe(state);
  });

  it('clearSpawn clears an existing spawn', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      spawn: { x: 0, y: 0, floor: 'floor-0' },
    });
    state = clearSpawn(state);
    expect(state.spawn).toBeUndefined();
  });

  it('clearSpawn is a safe no-op when no spawn is set', () => {
    const state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    const result = clearSpawn(state);
    expect(result).toBe(state);
  });

  it('clearSpawn is ignored mid-stroke, same as setTool', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      spawn: { x: 0, y: 0, floor: 'floor-0' },
      fillTileId: 1,
    });
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    const result = clearSpawn(state);
    expect(result).toBe(state);
  });
});

describe('painter-store: spawn-point tool (Slice 5b -- loop-crear-jugar)', () => {
  it('pointerDown with the spawn-point tool sets the spawn on the active floor without starting a stroke', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'spawn-point');
    const { state: nextState } = pointerDown(state, { x: 2, y: 3 });

    expect(nextState.spawn).toEqual({ x: 2, y: 3, floor: 'floor-0' });
    expect(nextState.stroke).toEqual({ status: 'idle' });
  });

  it('a second spawn-point click replaces the existing spawn (single spawn per map)', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'spawn-point');
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    ({ state } = pointerDown(state, { x: 3, y: 3 }));

    expect(state.spawn).toEqual({ x: 3, y: 3, floor: 'floor-0' });
  });

  it('places the spawn on whichever floor is active at click time', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addFloor(state, { id: 'floor-1' }); // now active
    state = setTool(state, 'spawn-point');
    ({ state } = pointerDown(state, { x: 1, y: 1 }));

    expect(state.spawn).toEqual({ x: 1, y: 1, floor: 'floor-1' });
  });
});

describe('painter-store: stair-link tool 2-click flow (Slice 5b -- loop-crear-jugar)', () => {
  it('the FIRST click with the stair-link tool records a pending entry and creates no link yet', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setTool(state, 'stair-link');
    const { state: nextState } = pointerDown(state, { x: 2, y: 3 });

    expect(nextState.pendingStairEntry).toEqual({ floor: 'floor-0', x: 2, y: 3 });
    expect(nextState.stairLinks).toEqual([]);
    expect(nextState.stroke).toEqual({ status: 'idle' });
  });

  it('the SECOND click (after switching floors) creates a 2-waypoint StairLinkDocument and clears the pending entry', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addFloor(state, { id: 'floor-1' }); // now active
    state = selectFloor(state, 0); // back to floor-0, the "from" floor
    state = setTool(state, 'stair-link');
    ({ state } = pointerDown(state, { x: 2, y: 3 })); // entry click on floor-0

    state = selectFloor(state, 1); // switch to floor-1, the "to" floor
    const result = pointerDown(state, { x: 0, y: 0 }, { newStairLinkId: 'stair-1' });

    expect(result.state.stairLinks).toEqual([
      {
        id: 'stair-1',
        fromFloor: 'floor-0',
        toFloor: 'floor-1',
        bidirectional: true,
        waypoints: [
          { x: 2, y: 3, floor: 'floor-0' },
          { x: 0, y: 0, floor: 'floor-1' },
        ],
      },
    ]);
    expect(result.state.pendingStairEntry).toBeUndefined();
  });

  it('the SECOND click without a caller-supplied newStairLinkId is a safe no-op (stays mid-flow)', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addFloor(state, { id: 'floor-1' });
    state = selectFloor(state, 0);
    state = setTool(state, 'stair-link');
    ({ state } = pointerDown(state, { x: 2, y: 3 }));

    state = selectFloor(state, 1);
    const result = pointerDown(state, { x: 0, y: 0 });

    expect(result.state.stairLinks).toEqual([]);
    expect(result.state.pendingStairEntry).toEqual({ floor: 'floor-0', x: 2, y: 3 });
  });

  it('a third click after a completed link starts a brand-new pending entry (flow resets)', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addFloor(state, { id: 'floor-1' });
    state = selectFloor(state, 0);
    state = setTool(state, 'stair-link');
    ({ state } = pointerDown(state, { x: 2, y: 3 }));
    state = selectFloor(state, 1);
    ({ state } = pointerDown(state, { x: 0, y: 0 }, { newStairLinkId: 'stair-1' }));

    const result = pointerDown(state, { x: 1, y: 1 });
    expect(result.state.pendingStairEntry).toEqual({ floor: 'floor-1', x: 1, y: 1 });
    expect(result.state.stairLinks).toHaveLength(1);
  });
});

const PROP_OBJECT_A = 'a'.repeat(64);
const PROP_OBJECT_B = 'b'.repeat(64);

describe('painter-store: prop tool (C5 WU-04 -- depth-props-hd)', () => {
  it('nextPropId returns the first free prop-N id', () => {
    expect(nextPropId([])).toBe('prop-1');
    expect(
      nextPropId([{ id: 'prop-1', x: 0, y: 0, floor: 'floor-0', object: PROP_OBJECT_A }]),
    ).toBe('prop-2');
    expect(
      nextPropId([
        { id: 'prop-1', x: 0, y: 0, floor: 'floor-0', object: PROP_OBJECT_A },
        { id: 'prop-3', x: 1, y: 1, floor: 'floor-0', object: PROP_OBJECT_A },
      ]),
    ).toBe('prop-2');
  });

  it('placeProp adds an entry with the next free id, active object, and no optional fields', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = placeProp(state, { x: 2, y: 3 });

    expect(state.props).toEqual([
      { id: 'prop-1', x: 2, y: 3, floor: 'floor-0', object: PROP_OBJECT_A },
    ]);
    expect(state.props[0]).not.toHaveProperty('scale');
    expect(state.props[0]).not.toHaveProperty('rotationY');
    expect(state.props[0]).not.toHaveProperty('animation');
  });

  it('placeProp / place with no selected glb is a no-op', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    const afterPlace = placeProp(state, { x: 1, y: 1 });
    expect(afterPlace).toBe(state);

    state = setTool(state, 'prop');
    const { state: afterClick } = pointerDown(state, { x: 1, y: 1 });
    expect(afterClick).toBe(state);
    expect(afterClick.props).toEqual([]);
    expect(afterClick.stroke).toEqual({ status: 'idle' });
  });

  it('pointerDown with the prop tool places on the active floor without starting a stroke', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = setTool(state, 'prop');
    const { state: next } = pointerDown(state, { x: 1, y: 2 });

    expect(next.props).toEqual([
      { id: 'prop-1', x: 1, y: 2, floor: 'floor-0', object: PROP_OBJECT_A },
    ]);
    expect(next.stroke).toEqual({ status: 'idle' });
  });

  it('a second place gets prop-2 and may share a tile with the first', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = placeProp(state, { x: 1, y: 1 });
    state = setActivePropObject(state, PROP_OBJECT_B);
    state = placeProp(state, { x: 1, y: 1 });

    expect(state.props.map((p) => p.id)).toEqual(['prop-1', 'prop-2']);
    expect(state.props[1]).toMatchObject({ x: 1, y: 1, object: PROP_OBJECT_B });
  });

  it('removeProp deletes the entry; undo/redo restores it', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = placeProp(state, { x: 0, y: 0 });
    state = placeProp(state, { x: 1, y: 1 });
    state = removeProp(state, 'prop-1');
    expect(state.props.map((p) => p.id)).toEqual(['prop-2']);

    ({ state } = undoProp(state));
    // Undo-of-remove re-appends (same as room undo) -- order is not reconstructed.
    expect(state.props).toContainEqual({
      id: 'prop-1',
      x: 0,
      y: 0,
      floor: 'floor-0',
      object: PROP_OBJECT_A,
    });
    expect(state.props.map((p) => p.id).sort()).toEqual(['prop-1', 'prop-2']);

    ({ state } = redoProp(state));
    expect(state.props.map((p) => p.id)).toEqual(['prop-2']);
  });

  it('undoProp undoes a place as well', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = placeProp(state, { x: 2, y: 2 });
    ({ state } = undoProp(state));
    expect(state.props).toEqual([]);
    ({ state } = redoProp(state));
    expect(state.props).toEqual([
      { id: 'prop-1', x: 2, y: 2, floor: 'floor-0', object: PROP_OBJECT_A },
    ]);
  });

  it('places the prop on whichever floor is active at click time', () => {
    let state = createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
    state = addFloor(state, { id: 'floor-1' });
    state = setActivePropObject(state, PROP_OBJECT_A);
    state = setTool(state, 'prop');
    ({ state } = pointerDown(state, { x: 3, y: 3 }));

    expect(state.props).toEqual([
      { id: 'prop-1', x: 3, y: 3, floor: 'floor-1', object: PROP_OBJECT_A },
    ]);
  });

  /**
   * Panel "Place at tile" path: same placement + stroke-cancel resilience as
   * pointerDown for prop, but does not require the prop tool to be active.
   */
  it('placePropAtTile lands identically to the prop pointerDown path', () => {
    const ready = setActivePropObject(
      createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 }),
      PROP_OBJECT_A,
    );
    // Stuck brush stroke — both paths must cancel it first.
    let stroking = ready;
    ({ state: stroking } = pointerDown(stroking, { x: 0, y: 0 }));
    expect(stroking.stroke.status).toBe('stroking');

    const viaButton = placePropAtTile(stroking, { x: 1, y: 2 });
    expect(viaButton.tool).toBe(stroking.tool); // explicit action: tool unchanged

    const { state: viaPointer } = pointerDown(setTool(stroking, 'prop'), { x: 1, y: 2 });
    expect(viaButton.props).toEqual(viaPointer.props);
    expect(viaButton.props).toEqual([
      { id: 'prop-1', x: 1, y: 2, floor: 'floor-0', object: PROP_OBJECT_A },
    ]);
    expect(viaButton.stroke).toEqual({ status: 'idle' });
    expect(viaPointer.stroke).toEqual({ status: 'idle' });
    expect(activeFloorState(viaButton).propCommandStack).toEqual(
      activeFloorState(viaPointer).propCommandStack,
    );
  });
});

const NPC_SPRITE_A = 'c'.repeat(64);
const NPC_SPRITE_B = 'd'.repeat(64);
const EVENT_TALK = 'talk-elder';
const EVENT_GATE = 'open-gate';

function npcReadyState(overrides: Parameters<typeof createPainterState>[0] = {}) {
  let state = createPainterState({
    ...oneFloor(4, 4),
    width: 4,
    height: 4,
    eventKeys: [EVENT_TALK, EVENT_GATE],
    ...overrides,
  });
  state = setActiveNpcSpriteObject(state, NPC_SPRITE_A);
  return state;
}

function triggerReadyState(overrides: Parameters<typeof createPainterState>[0] = {}) {
  return createPainterState({
    ...oneFloor(4, 4),
    width: 4,
    height: 4,
    eventKeys: [EVENT_TALK, EVENT_GATE],
    ...overrides,
  });
}

describe('painter-store: npc tool (c1a follow-up)', () => {
  it('nextNpcId returns the first free npc-N id', () => {
    expect(nextNpcId([])).toBe('npc-1');
    expect(
      nextNpcId([
        {
          id: 'npc-1',
          x: 0,
          y: 0,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
          onInteract: EVENT_TALK,
        },
      ]),
    ).toBe('npc-2');
    expect(
      nextNpcId([
        {
          id: 'npc-1',
          x: 0,
          y: 0,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
          onInteract: EVENT_TALK,
        },
        {
          id: 'npc-3',
          x: 1,
          y: 1,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
          onInteract: EVENT_TALK,
        },
      ]),
    ).toBe('npc-2');
  });

  it('placeNpc assigns next free id, active sprite/facing/event, and no routine', () => {
    let state = npcReadyState();
    state = setActiveNpcFacing(state, 'left');
    state = setActiveNpcCharacterIndex(state, 2);
    state = setActiveNpcEventKey(state, EVENT_GATE);
    state = placeNpc(state, { x: 2, y: 3 });

    expect(state.npcs).toEqual([
      {
        id: 'npc-1',
        x: 2,
        y: 3,
        floor: 'floor-0',
        facing: 'left',
        sprite: { object: NPC_SPRITE_A, characterIndex: 2 },
        onInteract: EVENT_GATE,
      },
    ]);
    expect(state.npcs[0]).not.toHaveProperty('routine');
  });

  it('duplicate-tile NPC placement on the same floor is a no-op', () => {
    let state = npcReadyState();
    state = placeNpc(state, { x: 1, y: 1 });
    state = setActiveNpcSpriteObject(state, NPC_SPRITE_B);
    const beforeDup = state;
    state = placeNpc(state, { x: 1, y: 1 });
    expect(state).toBe(beforeDup);
    expect(state.npcs).toHaveLength(1);
    expect(state.npcs[0]?.sprite.object).toBe(NPC_SPRITE_A);
  });

  it('same tile on a different floor is allowed', () => {
    let state = npcReadyState();
    state = placeNpc(state, { x: 1, y: 1 });
    state = addFloor(state, { id: 'floor-1' });
    state = placeNpc(state, { x: 1, y: 1 });
    expect(state.npcs.map((n) => n.id)).toEqual(['npc-1', 'npc-2']);
    expect(state.npcs[1]).toMatchObject({ x: 1, y: 1, floor: 'floor-1' });
  });

  it('placement with zero events is unavailable (no-op)', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [],
    });
    state = setActiveNpcSpriteObject(state, NPC_SPRITE_A);
    const after = placeNpc(state, { x: 0, y: 0 });
    expect(after).toBe(state);
    expect(after.npcs).toEqual([]);

    state = setTool(state, 'npc');
    const { state: afterClick } = pointerDown(state, { x: 0, y: 0 });
    expect(afterClick.npcs).toEqual([]);
    expect(afterClick.stroke).toEqual({ status: 'idle' });
  });

  it('placement with no selected sprite is a no-op', () => {
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [EVENT_TALK],
    });
    expect(placeNpc(state, { x: 0, y: 0 })).toBe(state);
  });

  it('pointerDown with the npc tool places without starting a stroke', () => {
    let state = npcReadyState();
    state = setTool(state, 'npc');
    const { state: next } = pointerDown(state, { x: 1, y: 2 });

    expect(next.npcs).toEqual([
      {
        id: 'npc-1',
        x: 1,
        y: 2,
        floor: 'floor-0',
        facing: 'down',
        sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
        onInteract: EVENT_TALK,
      },
    ]);
    expect(next.stroke).toEqual({ status: 'idle' });
  });

  /**
   * Panel "Place at tile" path: same placement + stroke-cancel resilience as
   * pointerDown for npc, but does not require the npc tool to be active.
   */
  it('placeNpcAtTile lands identically to the npc pointerDown path', () => {
    const ready = npcReadyState();
    let stroking = ready;
    ({ state: stroking } = pointerDown(stroking, { x: 0, y: 0 }));
    expect(stroking.stroke.status).toBe('stroking');

    const viaButton = placeNpcAtTile(stroking, { x: 1, y: 2 });
    expect(viaButton.tool).toBe(stroking.tool);

    const { state: viaPointer } = pointerDown(setTool(stroking, 'npc'), { x: 1, y: 2 });
    expect(viaButton.npcs).toEqual(viaPointer.npcs);
    expect(viaButton.npcs).toEqual([
      {
        id: 'npc-1',
        x: 1,
        y: 2,
        floor: 'floor-0',
        facing: 'down',
        sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
        onInteract: EVENT_TALK,
      },
    ]);
    expect(viaButton.stroke).toEqual({ status: 'idle' });
    expect(activeFloorState(viaButton).npcCommandStack).toEqual(
      activeFloorState(viaPointer).npcCommandStack,
    );
  });

  /**
   * Live-smoke regression (c1a follow-up): the panel never calls `placeNpc`
   * directly — it writes sprite/event via viewport setters, then the canvas
   * pointer path runs `setTool` + `pointerDown`. A stuck brush stroke must not
   * drop the sprite write or block the tool switch (that asymmetry let trigger
   * place on load defaults while NPC never landed).
   */
  it('viewport-surface path: sprite/event setters then pointerDown place after a stuck stroke', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [EVENT_TALK, EVENT_GATE],
      fillTileId: 1,
    });
    // Begin a brush stroke and never pointerUp — simulates a lost pointerup.
    ({ state } = pointerDown(state, { x: 0, y: 0 }));
    expect(state.stroke.status).toBe('stroking');
    expect(state.activeNpcSpriteObject).toBeUndefined();

    // Same order as PainterPanel → PainterViewport public methods.
    state = setActiveNpcSpriteObject(state, NPC_SPRITE_A);
    state = setActiveNpcEventKey(state, EVENT_GATE);
    state = setTool(state, 'npc');
    expect(state.stroke).toEqual({ status: 'idle' });
    expect(state.tool).toBe('npc');
    expect(state.activeNpcSpriteObject).toBe(NPC_SPRITE_A);
    expect(state.activeNpcEventKey).toBe(EVENT_GATE);

    const { state: placed } = pointerDown(state, { x: 2, y: 3 });
    expect(placed.npcs).toEqual([
      {
        id: 'npc-1',
        x: 2,
        y: 3,
        floor: 'floor-0',
        facing: 'down',
        sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
        onInteract: EVENT_GATE,
      },
    ]);
    expect(placed.stroke).toEqual({ status: 'idle' });
  });

  it('removeNpc deletes; undo/redo restore', () => {
    let state = npcReadyState();
    state = placeNpc(state, { x: 0, y: 0 });
    state = placeNpc(state, { x: 1, y: 1 });
    state = removeNpc(state, 'npc-1');
    expect(state.npcs.map((n) => n.id)).toEqual(['npc-2']);

    ({ state } = undoNpc(state));
    expect(state.npcs.map((n) => n.id).sort()).toEqual(['npc-1', 'npc-2']);

    ({ state } = redoNpc(state));
    expect(state.npcs.map((n) => n.id)).toEqual(['npc-2']);
  });

  it('undoNpc undoes a place as well', () => {
    let state = npcReadyState();
    state = placeNpc(state, { x: 2, y: 2 });
    ({ state } = undoNpc(state));
    expect(state.npcs).toEqual([]);
    ({ state } = redoNpc(state));
    expect(state.npcs[0]?.id).toBe('npc-1');
  });
});

describe('painter-store: trigger tool (c1a follow-up)', () => {
  it('nextTriggerId returns the first free trigger-N id', () => {
    expect(nextTriggerId([])).toBe('trigger-1');
    expect(
      nextTriggerId([
        { id: 'trigger-1', x: 0, y: 0, floor: 'floor-0', on: 'enter', event: EVENT_GATE },
      ]),
    ).toBe('trigger-2');
  });

  it('placeTrigger carries on-mode and event key with next free id', () => {
    let state = triggerReadyState();
    state = setActiveTriggerOn(state, 'interact');
    state = setActiveTriggerEventKey(state, EVENT_GATE);
    state = placeTrigger(state, { x: 2, y: 3 });

    expect(state.triggers).toEqual([
      {
        id: 'trigger-1',
        x: 2,
        y: 3,
        floor: 'floor-0',
        on: 'interact',
        event: EVENT_GATE,
      },
    ]);
  });

  it('placement with zero events is unavailable (no-op)', () => {
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [],
    });
    expect(placeTrigger(state, { x: 0, y: 0 })).toBe(state);

    const tooled = setTool(state, 'trigger');
    const { state: afterClick } = pointerDown(tooled, { x: 0, y: 0 });
    expect(afterClick.triggers).toEqual([]);
    expect(afterClick.stroke).toEqual({ status: 'idle' });
  });

  it('pointerDown with the trigger tool places without starting a stroke', () => {
    let state = triggerReadyState();
    state = setTool(state, 'trigger');
    const { state: next } = pointerDown(state, { x: 1, y: 2 });

    expect(next.triggers).toEqual([
      {
        id: 'trigger-1',
        x: 1,
        y: 2,
        floor: 'floor-0',
        on: 'enter',
        event: EVENT_TALK,
      },
    ]);
    expect(next.stroke).toEqual({ status: 'idle' });
  });

  /**
   * Panel "Place at tile" path: same placement + stroke-cancel resilience as
   * pointerDown for trigger, but does not require the trigger tool to be active.
   */
  it('placeTriggerAtTile lands identically to the trigger pointerDown path', () => {
    const ready = triggerReadyState();
    let stroking = ready;
    ({ state: stroking } = pointerDown(stroking, { x: 0, y: 0 }));
    expect(stroking.stroke.status).toBe('stroking');

    const viaButton = placeTriggerAtTile(stroking, { x: 1, y: 2 });
    expect(viaButton.tool).toBe(stroking.tool);

    const { state: viaPointer } = pointerDown(setTool(stroking, 'trigger'), { x: 1, y: 2 });
    expect(viaButton.triggers).toEqual(viaPointer.triggers);
    expect(viaButton.triggers).toEqual([
      {
        id: 'trigger-1',
        x: 1,
        y: 2,
        floor: 'floor-0',
        on: 'enter',
        event: EVENT_TALK,
      },
    ]);
    expect(viaButton.stroke).toEqual({ status: 'idle' });
    expect(activeFloorState(viaButton).triggerCommandStack).toEqual(
      activeFloorState(viaPointer).triggerCommandStack,
    );
  });

  it('removeTrigger deletes; undo/redo restore', () => {
    let state = triggerReadyState();
    state = placeTrigger(state, { x: 0, y: 0 });
    state = placeTrigger(state, { x: 1, y: 1 });
    state = removeTrigger(state, 'trigger-1');
    expect(state.triggers.map((t) => t.id)).toEqual(['trigger-2']);

    ({ state } = undoTrigger(state));
    expect(state.triggers.map((t) => t.id).sort()).toEqual(['trigger-1', 'trigger-2']);

    ({ state } = redoTrigger(state));
    expect(state.triggers.map((t) => t.id)).toEqual(['trigger-2']);
  });
});

describe('painter-store: events + worldSeeds (events editor WU-01)', () => {
  function blank() {
    return createPainterState({ ...oneFloor(4, 4), width: 4, height: 4 });
  }

  it('createPainterState seeds events/worldSeeds; eventKeys is derived from events', () => {
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      events: {
        intro: [{ type: 'setWorldVar', key: 'started', value: true }],
      },
      worldSeeds: { started: false },
    });
    expect(state.events.intro).toHaveLength(1);
    expect(state.worldSeeds).toEqual({ started: false });
    expect(state.eventKeys).toEqual(['intro']);
  });

  it('eventKeys option still seeds empty event scripts (npc/trigger placement back-compat)', () => {
    const state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [EVENT_TALK, EVENT_GATE],
    });
    expect(state.events).toEqual({ [EVENT_TALK]: [], [EVENT_GATE]: [] });
    expect(state.eventKeys).toEqual([EVENT_TALK, EVENT_GATE]);
  });

  it('addEvent validates non-empty unique keys and creates an empty command list', () => {
    let state = blank();
    state = addEvent(state, 'intro');
    expect(state.events.intro).toEqual([]);
    expect(state.eventKeys).toContain('intro');

    expect(addEvent(state, '')).toBe(state);
    expect(addEvent(state, '   ')).toBe(state);
    expect(addEvent(state, 'intro')).toBe(state);
  });

  it('renameEvent renames the script and rewrites npc/trigger refs atomically', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      events: { oldKey: [], other: [] },
      npcs: [
        {
          id: 'npc-1',
          x: 0,
          y: 0,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
          onInteract: 'oldKey',
        },
      ],
      triggers: [{ id: 'trigger-1', x: 1, y: 1, floor: 'floor-0', on: 'enter', event: 'oldKey' }],
      activeNpcEventKey: 'oldKey',
      activeTriggerEventKey: 'oldKey',
    });
    state = renameEvent(state, 'oldKey', 'newKey');
    expect(state.events).toEqual({ newKey: [], other: [] });
    expect(state.eventKeys).toEqual(['newKey', 'other']);
    expect(state.npcs[0]?.onInteract).toBe('newKey');
    expect(state.triggers[0]?.event).toBe('newKey');
    expect(state.activeNpcEventKey).toBe('newKey');
    expect(state.activeTriggerEventKey).toBe('newKey');
  });

  it('removeEvent is blocked while referenced; works after unreferencing', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      events: { talk: [], spare: [] },
      npcs: [
        {
          id: 'npc-1',
          x: 0,
          y: 0,
          floor: 'floor-0',
          facing: 'down',
          sprite: { object: NPC_SPRITE_A, characterIndex: 0 },
          onInteract: 'talk',
        },
      ],
    });
    const blocked = removeEvent(state, 'talk');
    expect(blocked).toBe(state);
    expect(blocked.events.talk).toEqual([]);

    state = removeNpc(state, 'npc-1');
    state = removeEvent(state, 'talk');
    expect(state.events).toEqual({ spare: [] });
    expect(state.eventKeys).toEqual(['spare']);
  });

  it('removeEvent is also blocked by a trigger reference', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      events: { gate: [] },
      triggers: [{ id: 'trigger-1', x: 0, y: 0, floor: 'floor-0', on: 'enter', event: 'gate' }],
    });
    expect(removeEvent(state, 'gate')).toBe(state);
    state = removeTrigger(state, 'trigger-1');
    state = removeEvent(state, 'gate');
    expect(state.events).toEqual({});
  });

  it('addCommand inserts a minimal default for each of the 8 kinds at the path (incl. nested then/else)', () => {
    let state = blank();
    state = addEvent(state, 'script');

    state = addCommand(state, 'script', [0], 'conditional');
    expect(state.events.script?.[0]).toEqual({
      type: 'conditional',
      if: { key: '', op: 'eq', value: false },
      then: [],
    });

    state = addCommand(state, 'script', [0, 'then', 0], 'moveEntity');
    state = addCommand(state, 'script', [0, 'else', 0], 'giveItem');
    state = addCommand(state, 'script', [1], 'showDialogue');
    state = addCommand(state, 'script', [2], 'setWorldVar');
    state = addCommand(state, 'script', [3], 'teleport');
    state = addCommand(state, 'script', [4], 'transferMap');
    state = addCommand(state, 'script', [5], 'modifyStat');

    const cmds = state.events.script ?? [];
    expect(cmds[0]).toMatchObject({
      type: 'conditional',
      then: [{ type: 'moveEntity', entityId: '', direction: 'down', steps: 1 }],
      else: [{ type: 'giveItem', itemId: '', amount: 1 }],
    });
    expect(cmds[1]).toEqual({ type: 'showDialogue', source: { kind: 'text', lines: [] } });
    expect(cmds[2]).toEqual({ type: 'setWorldVar', key: '', value: false });
    expect(cmds[3]).toEqual({ type: 'teleport', entityId: '', x: 0, y: 0 });
    expect(cmds[4]).toEqual({ type: 'transferMap', mapFile: '', x: 0, y: 0 });
    expect(cmds[5]).toEqual({ type: 'modifyStat', statId: '', delta: 1 });
  });

  it('updateCommand patches fields; moveCommand reorders within bounds; removeCommand drops', () => {
    let state = blank();
    state = addEvent(state, 'script');
    state = addCommand(state, 'script', [0], 'moveEntity');
    state = addCommand(state, 'script', [1], 'setWorldVar');
    state = addCommand(state, 'script', [2], 'giveItem');

    state = updateCommand(state, 'script', [0], { entityId: 'player', steps: 3 });
    expect(state.events.script?.[0]).toEqual({
      type: 'moveEntity',
      entityId: 'player',
      direction: 'down',
      steps: 3,
    });

    state = moveCommand(state, 'script', [0], 1);
    expect(state.events.script?.map((c) => c.type)).toEqual([
      'setWorldVar',
      'moveEntity',
      'giveItem',
    ]);

    const atTop = moveCommand(state, 'script', [0], -1);
    expect(atTop).toBe(state);
    const atBottom = moveCommand(state, 'script', [2], 1);
    expect(atBottom).toBe(state);

    state = removeCommand(state, 'script', [1]);
    expect(state.events.script?.map((c) => c.type)).toEqual(['setWorldVar', 'giveItem']);
  });

  it('updateCommand can patch a nested then-branch command via path', () => {
    let state = blank();
    state = addEvent(state, 'script');
    state = addCommand(state, 'script', [0], 'conditional');
    state = addCommand(state, 'script', [0, 'then', 0], 'setWorldVar');
    state = updateCommand(state, 'script', [0, 'then', 0], { key: 'flag', value: true });
    const root = state.events.script?.[0];
    expect(root?.type).toBe('conditional');
    if (root?.type === 'conditional') {
      expect(root.then[0]).toEqual({ type: 'setWorldVar', key: 'flag', value: true });
    }
  });

  it('freshly added eventKeys feed placeNpc / placeTrigger guards (no stale snapshot)', () => {
    let state = createPainterState({
      ...oneFloor(4, 4),
      width: 4,
      height: 4,
      eventKeys: [],
    });
    state = setActiveNpcSpriteObject(state, NPC_SPRITE_A);
    expect(placeNpc(state, { x: 0, y: 0 })).toBe(state);

    state = addEvent(state, 'brand-new');
    expect(state.eventKeys).toEqual(['brand-new']);
    expect(state.activeNpcEventKey).toBe('brand-new');
    state = placeNpc(state, { x: 0, y: 0 });
    expect(state.npcs[0]?.onInteract).toBe('brand-new');

    state = addEvent(state, 'trigger-evt');
    state = setActiveTriggerEventKey(state, 'trigger-evt');
    state = placeTrigger(state, { x: 1, y: 1 });
    expect(state.triggers[0]?.event).toBe('trigger-evt');
  });

  it('setWorldSeed / removeWorldSeed mutate worldSeeds', () => {
    let state = blank();
    state = setWorldSeed(state, 'coins', 3);
    state = setWorldSeed(state, 'open', true);
    state = setWorldSeed(state, 'name', 'town');
    expect(state.worldSeeds).toEqual({ coins: 3, open: true, name: 'town' });
    state = removeWorldSeed(state, 'open');
    expect(state.worldSeeds).toEqual({ coins: 3, name: 'town' });
    expect(removeWorldSeed(state, 'missing')).toBe(state);
  });

  it('validateEventsDraft returns null for valid scripts and a message for invalid ones', () => {
    expect(
      validateEventsDraft({
        ok: [{ type: 'setWorldVar', key: 'a', value: 1 }],
      }),
    ).toBeNull();

    const err = validateEventsDraft({
      bad: [{ type: 'giveItem', itemId: '', amount: 1 }],
    });
    expect(typeof err).toBe('string');
    expect(err).toMatch(/Invalid Event Script/);
  });
});
