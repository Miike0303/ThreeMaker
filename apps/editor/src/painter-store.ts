/**
 * Painter store: wires the pure `ToolSM` (tool-sm.ts) to `@threemaker/map-format`'s
 * `TileDiff`/command-stack undo/redo model. Pure, framework-agnostic --
 * `EditorViewport`/React components call these functions and pass the
 * returned `diff` on to `patchChunks` (see `dirty-region.ts` for computing
 * which chunks that diff actually touches).
 *
 * Autotile neighbor-rule shape resolution is intentionally out of scope
 * this slice (see `tool-sm.ts`'s doc comment) -- every tool places the
 * literal active tile id (`fillTileId`), eraser is just `fillTileId = 0`.
 *
 * Plantas Apiladas (Slice 4, painter-floors spec): the map is an ordered
 * stack of floors, each with its OWN layers + undo/redo command stack.
 * Every painting/undo/redo op is scoped to `floors[activeFloor]` only --
 * see `activeFloorState`. Tool/layer/fill-id/semantic-mode selection and
 * the `semantics` tile-id-keyed overrides stay top-level/shared across
 * floors (catalog/palette is floor-agnostic per spec).
 *
 * Techos y Oclusion Interiores (Slice 5a, "Painter store room ops + undo"):
 * `PainterState.rooms` mirrors `MapDocument.rooms` exactly (a flat,
 * top-level `RoomDocument[]`, each referencing its floor by stable id --
 * NOT nested per floor, since the document schema itself isn't nested).
 * Every room CRUD op (`addRoom`/`removeRoom`/`renameRoom`/`addRoomRect`/
 * `removeRoomRect`) is scoped to the room(s) on `activeFloorState(state).id`
 * only, and pushes its own `RoomCommand` onto that floor's OWN
 * `roomCommandStack` -- a second, independent per-floor undo stack living
 * alongside `commandStack` (tile edits and room edits are undone via two
 * separate stacks/functions, `undo`/`redo` vs. `undoRoom`/`redoRoom`; this
 * slice does not unify them into one history).
 */

import type {
  CommandStackState,
  RoomDocument,
  RoomRect,
  SemanticClass,
  SemanticOverrides,
  TileCellDiff,
  TileDiff,
  TileLayerSet,
} from '@threemaker/map-format';
import {
  applyTileDiff,
  COMMAND_STACK_CAP,
  DEFAULT_FLOOR_HEIGHT,
  EMPTY_COMMAND_STACK,
  pushCommand,
  redoCommand,
  undoCommand,
} from '@threemaker/map-format';
import { assignSemanticClass, resolveTouchedTileIds } from './semantic-store.js';
import type { TilePoint, ToolId, ToolSMState, ToolSMStrokingState } from './tool-sm.js';
import { beginStroke, continueStroke, endStroke, TOOL_SM_IDLE } from './tool-sm.js';

/**
 * One room mutation's before/after `RoomDocument` (Slice 5a room-undo
 * model, local to this module -- there is no other consumer of room-diff
 * undo, unlike `TileDiff`/`CommandStackState`, which `patchChunks` also
 * applies). `before`/`after` absent means "the room did not exist" (add:
 * `before` absent; remove: `after` absent); both present for
 * rename/rect-edit ops. `floor`+`id` identify which room in
 * `PainterState.rooms` this command targets -- always the floor the
 * command was pushed on, never re-targeted by a later floor switch.
 */
export interface RoomCommand {
  readonly floor: string;
  readonly id: string;
  readonly before?: RoomDocument;
  readonly after?: RoomDocument;
}

export interface RoomCommandStackState {
  readonly undoStack: readonly RoomCommand[];
  readonly redoStack: readonly RoomCommand[];
}

export const EMPTY_ROOM_COMMAND_STACK: RoomCommandStackState = { undoStack: [], redoStack: [] };

/** One stacked floor's paintable state: its own tile layers plus its own independent undo/redo command stack (spec: "per-floor undo isolation"), and (Slice 5a) its own independent room-command stack (`roomCommandStack`) -- a floor's room edits undo/redo separately from its tile edits, never crossing into another floor's history. Structurally parallel to `map-compose.ts`'s `PainterFloorSource` (`{id, label?, baseElevation, layers}`, no command stack) and `PainterFloorInit` below (same fields as this type, minus `commandStack`/`roomCommandStack`) -- three separate types by design, not accidental divergence: each belongs to its own layer (composed-doc source, store-init input, live store state). */
export interface PainterFloorState {
  readonly id: string;
  readonly label?: string;
  readonly baseElevation: number;
  readonly layers: TileLayerSet;
  readonly commandStack: CommandStackState;
  readonly roomCommandStack: RoomCommandStackState;
}

/** A floor's initial layers, as sourced from a loaded/composed `MapDocument` (see `map-compose.ts`'s `painterFloorsFromDocument`, which returns this exact shape as `PainterFloorSource`) or freshly created for a blank floor -- command stacks are always session-local, never persisted. */
export interface PainterFloorInit {
  readonly id: string;
  readonly label?: string;
  readonly baseElevation: number;
  readonly layers: TileLayerSet;
}

export interface PainterState {
  readonly floors: readonly PainterFloorState[];
  /** Index into `floors` of the floor currently being edited/rendered (spec: "editor viewport shows active floor only"). */
  readonly activeFloor: number;
  readonly width: number;
  readonly height: number;
  readonly tool: ToolId;
  readonly activeLayer: 0 | 1 | 2 | 3;
  /** The tile id every non-eyedropper tool paints; 0 = eraser. */
  readonly fillTileId: number;
  readonly stroke: ToolSMState;
  /** When true, a committed stroke assigns `semanticClass` to every distinct tile id it touches instead of painting -- the visual tile layer is never modified (spec: "Semantic-only edit"). */
  readonly semanticMode: boolean;
  readonly semanticClass: SemanticClass;
  readonly semantics: SemanticOverrides;
  /** Every authored room across every floor (Slice 5a), mirroring `MapDocument.rooms` exactly -- flat, top-level, each entry referencing its floor by stable id. */
  readonly rooms: readonly RoomDocument[];
}

export interface CreatePainterStateOptions {
  /** Non-empty ordered floor stack (index 0 = ground), matching `MapDocument.floors`. */
  readonly floors: readonly PainterFloorInit[];
  readonly width: number;
  readonly height: number;
  readonly fillTileId?: number;
  readonly semantics?: SemanticOverrides;
  /** Which floor starts active; defaults to 0 (ground). */
  readonly activeFloor?: number;
  /** Initial rooms (map load path), matching `MapDocument.rooms`; defaults to none authored. */
  readonly rooms?: readonly RoomDocument[];
}

/** Adjacent same-typed args (`width`/`height`/`fillTileId`/`semantics`) are grouped into one options object -- see the gate-review "parameter objects" suggestion. Every floor gets a fresh, empty command stack AND room-command stack: undo/redo history is session-local, never carried over from a saved document. */
export function createPainterState(options: CreatePainterStateOptions): PainterState {
  const {
    floors,
    width,
    height,
    fillTileId = 0,
    semantics = {},
    activeFloor = 0,
    rooms = [],
  } = options;
  return {
    floors: floors.map((floor) => ({
      ...floor,
      commandStack: EMPTY_COMMAND_STACK,
      roomCommandStack: EMPTY_ROOM_COMMAND_STACK,
    })),
    activeFloor,
    width,
    height,
    tool: 'brush',
    activeLayer: 0,
    fillTileId,
    stroke: TOOL_SM_IDLE,
    semanticMode: false,
    semanticClass: 'none',
    semantics,
    rooms,
  };
}

/** The floor currently being edited/rendered. Throws if `activeFloor` is out of range -- an internal-invariant violation, never user-reachable (every mutator below keeps `activeFloor` in range). */
export function activeFloorState(state: PainterState): PainterFloorState {
  const floor = state.floors[state.activeFloor];
  if (!floor) {
    throw new Error(
      `activeFloorState: no floor at index ${state.activeFloor} (floors.length=${state.floors.length}).`,
    );
  }
  return floor;
}

function replaceActiveFloor(
  state: PainterState,
  patch: Partial<Pick<PainterFloorState, 'layers' | 'commandStack' | 'roomCommandStack'>>,
): PainterState {
  const floors = state.floors.map((floor, index) =>
    index === state.activeFloor ? { ...floor, ...patch } : floor,
  );
  return { ...state, floors };
}

function createEmptyLayers(width: number, height: number): TileLayerSet {
  const size = width * height;
  const empty = () => new Array(size).fill(0);
  return [empty(), empty(), empty(), empty()];
}

export interface AddFloorOptions {
  readonly id: string;
  readonly label?: string;
}

/**
 * Appends a new blank floor on TOP of the stack (stacking order, not
 * active-floor order) at `baseElevation = topFloor.baseElevation +
 * DEFAULT_FLOOR_HEIGHT` [CHECKPOINT-APPROVED default], and makes it active
 * (spec: "adding a floor"). Ignored mid-stroke, same as `setTool`.
 */
export function addFloor(state: PainterState, options: AddFloorOptions): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const top = state.floors[state.floors.length - 1];
  const baseElevation = (top?.baseElevation ?? 0) + DEFAULT_FLOOR_HEIGHT;
  const floor: PainterFloorState = {
    id: options.id,
    ...(options.label !== undefined ? { label: options.label } : {}),
    baseElevation,
    layers: createEmptyLayers(state.width, state.height),
    commandStack: EMPTY_COMMAND_STACK,
    roomCommandStack: EMPTY_ROOM_COMMAND_STACK,
  };
  const floors = [...state.floors, floor];
  return { ...state, floors, activeFloor: floors.length - 1 };
}

/** Switches the active floor. Ignored mid-stroke or for an out-of-range index. */
export function selectFloor(state: PainterState, index: number): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (index < 0 || index >= state.floors.length) return state;
  return { ...state, activeFloor: index };
}

/**
 * Removes the floor at `index`. Refuses (no-op) to drop the last remaining
 * floor -- min 1 floor is always enforced. Ignored mid-stroke or for an
 * out-of-range index. `activeFloor` is re-clamped: shifts down by one if a
 * floor BEFORE it was removed, stays at the same index (now pointing at
 * whatever took its place, or clamped to the new last floor) if the active
 * floor itself was removed.
 */
export function removeFloor(state: PainterState, index: number): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (state.floors.length <= 1) return state;
  if (index < 0 || index >= state.floors.length) return state;

  const floors = state.floors.filter((_, i) => i !== index);
  const activeFloor =
    index < state.activeFloor
      ? state.activeFloor - 1
      : Math.min(state.activeFloor, floors.length - 1);
  return { ...state, floors, activeFloor };
}

/** Toggles semantic-class painting mode. Ignored mid-stroke, same as `setTool`. */
export function setSemanticMode(state: PainterState, enabled: boolean): PainterState {
  if (state.stroke.status === 'stroking') return state;
  return { ...state, semanticMode: enabled };
}

/** Sets the class assigned by the next committed stroke while semantic mode is active. */
export function setSemanticClass(state: PainterState, cls: SemanticClass): PainterState {
  return { ...state, semanticClass: cls };
}

/** Switches the active tool. Ignored mid-stroke (a stroke commits/cancels via pointerup before the tool can change). */
export function setTool(state: PainterState, tool: ToolId): PainterState {
  if (state.stroke.status === 'stroking') return state;
  return { ...state, tool };
}

/** Switches the active editable layer (0-3). Ignored mid-stroke, same as `setTool`. */
export function setActiveLayer(state: PainterState, layer: 0 | 1 | 2 | 3): PainterState {
  if (state.stroke.status === 'stroking') return state;
  return { ...state, activeLayer: layer };
}

export function setFillTileId(state: PainterState, tileId: number): PainterState {
  return { ...state, fillTileId: tileId };
}

export interface PointerDownResult {
  readonly state: PainterState;
  /** Set only for the eyedropper tool, which picks immediately and never enters "stroking". */
  readonly pickedTileId?: number;
}

/** `pointerdown`: eyedropper picks immediately (no stroke) from the active floor; every other tool begins a stroke. */
export function pointerDown(state: PainterState, point: TilePoint): PointerDownResult {
  if (state.tool === 'eyedropper') {
    const floor = activeFloorState(state);
    const layer = floor.layers[state.activeLayer];
    const pickedTileId = layer?.[point.y * state.width + point.x] ?? 0;
    return { state, pickedTileId };
  }
  const stroke = beginStroke(state.stroke, state.tool, state.activeLayer, point);
  return { state: { ...state, stroke } };
}

/** `pointermove`: extends the in-progress stroke. No-op while idle. */
export function pointerMove(state: PainterState, point: TilePoint): PainterState {
  return { ...state, stroke: continueStroke(state.stroke, point) };
}

export interface PointerUpResult {
  readonly state: PainterState;
  /** The committed diff, if the stroke touched at least one cell whose value actually changed. Absent for a no-op stroke (e.g. filling with the value already there) OR while semantic mode is active (semantic edits never touch the tile layer -- see `semanticTileIds` instead). */
  readonly diff?: TileDiff;
  /** Set only when a stroke committed WHILE semantic mode was active: the distinct tile ids the stroke touched, which now carry `state.semanticClass`. The visual tile layer is unchanged. */
  readonly semanticTileIds?: ReadonlySet<number>;
}

/** `pointerup`: commits the in-progress stroke onto the ACTIVE floor only (spec: "editing the active floor only"). In semantic mode, assigns the active semantic class to every distinct tile id touched (no layer/diff change, and NOT part of the per-floor tile undo history). Otherwise computes the stroke's touched cells, builds a `TileDiff`, applies it to the active floor's layers, and pushes it onto the active floor's OWN command stack. No-op while idle. */
export function pointerUp(state: PainterState): PointerUpResult {
  if (state.stroke.status !== 'stroking') return { state };

  const stroke = state.stroke;
  const idleState: PainterState = { ...state, stroke: endStroke(state.stroke) };

  const floor = activeFloorState(state);
  const cells = computeStrokeTouchedCells(stroke, floor.layers, state.width, state.height);
  const layer = floor.layers[stroke.layer];
  if (!layer) return { state: idleState };

  if (state.semanticMode) {
    const tileIds = resolveTouchedTileIds(cells, layer, state.width);
    if (tileIds.size === 0) return { state: idleState };
    const semantics = assignSemanticClass(state.semantics, tileIds, state.semanticClass);
    return { state: { ...idleState, semantics }, semanticTileIds: tileIds };
  }

  const diff = buildTileDiff(cells, layer, state.width, stroke.layer, state.fillTileId);
  if (!diff) return { state: idleState };

  const layers = applyTileDiff(floor.layers, state.width, diff);
  const commandStack = pushCommand(floor.commandStack, diff);
  return { state: replaceActiveFloor(idleState, { layers, commandStack }), diff };
}

export interface CommandStepOutcome {
  readonly state: PainterState;
  readonly diff?: TileDiff;
}

/** Undoes the most recent committed stroke on the ACTIVE floor's OWN command stack, if any -- never a different floor's (spec: "per-floor undo isolation"). */
export function undo(state: PainterState): CommandStepOutcome {
  const floor = activeFloorState(state);
  const result = undoCommand(floor.commandStack);
  if (!result) return { state };
  const layers = applyTileDiff(floor.layers, state.width, result.diff);
  return {
    state: replaceActiveFloor(state, { layers, commandStack: result.state }),
    diff: result.diff,
  };
}

/** Re-applies the most recently undone stroke on the ACTIVE floor's OWN command stack, if any. */
export function redo(state: PainterState): CommandStepOutcome {
  const floor = activeFloorState(state);
  const result = redoCommand(floor.commandStack);
  if (!result) return { state };
  const layers = applyTileDiff(floor.layers, state.width, result.diff);
  return {
    state: replaceActiveFloor(state, { layers, commandStack: result.state }),
    diff: result.diff,
  };
}

// --- Room CRUD + per-floor undo (Slice 5a) ------------------------------

/** Replaces (or removes, if `next` is `undefined`) the room identified by `(floor, id)` in `rooms`, preserving document order for every other entry; a brand-new `(floor, id)` pair is appended. */
function upsertRoom(
  rooms: readonly RoomDocument[],
  floor: string,
  id: string,
  next: RoomDocument | undefined,
): readonly RoomDocument[] {
  const index = rooms.findIndex((room) => room.floor === floor && room.id === id);
  if (next === undefined) {
    return index === -1 ? rooms : rooms.filter((_, i) => i !== index);
  }
  if (index === -1) return [...rooms, next];
  return rooms.map((room, i) => (i === index ? next : room));
}

/** Commits a room mutation: sets the new top-level `rooms` array and pushes `command` onto the ACTIVE floor's OWN `roomCommandStack` (clears that floor's redo stack, caps at `COMMAND_STACK_CAP` -- same shape as `pushCommand` for tile diffs). */
function applyRoomMutation(
  state: PainterState,
  rooms: readonly RoomDocument[],
  command: RoomCommand,
): PainterState {
  const floor = activeFloorState(state);
  const undoStack = [...floor.roomCommandStack.undoStack, command].slice(-COMMAND_STACK_CAP);
  const withStack = replaceActiveFloor(state, { roomCommandStack: { undoStack, redoStack: [] } });
  return { ...withStack, rooms };
}

export interface AddRoomOptions {
  readonly id: string;
  readonly name?: string;
  readonly rects: readonly RoomRect[];
}

/** Adds a new room to the ACTIVE floor (spec: rooms are authored per floor), referencing it by stable floor id. Ignored mid-stroke, same as `setTool`. A no-op if a room with `options.id` already exists on the active floor -- room ids are unique PER FLOOR (see `validateRooms`), so use `renameRoom`/`addRoomRect` to modify an existing one instead. */
export function addRoom(state: PainterState, options: AddRoomOptions): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  if (state.rooms.some((room) => room.floor === floor.id && room.id === options.id)) return state;

  const room: RoomDocument =
    options.name !== undefined
      ? { id: options.id, name: options.name, floor: floor.id, rects: options.rects }
      : { id: options.id, floor: floor.id, rects: options.rects };
  const rooms = upsertRoom(state.rooms, floor.id, options.id, room);
  return applyRoomMutation(state, rooms, { floor: floor.id, id: options.id, after: room });
}

/** Removes the room `id` from the ACTIVE floor. Ignored mid-stroke. A safe no-op if no room with that id exists on the active floor. */
export function removeRoom(state: PainterState, id: string): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  const existing = state.rooms.find((room) => room.floor === floor.id && room.id === id);
  if (!existing) return state;

  const rooms = upsertRoom(state.rooms, floor.id, id, undefined);
  return applyRoomMutation(state, rooms, { floor: floor.id, id, before: existing });
}

/** Renames the room `id` on the ACTIVE floor (`name: undefined` clears an existing name), leaving its `rects` untouched. Ignored mid-stroke. A safe no-op if no room with that id exists on the active floor. */
export function renameRoom(
  state: PainterState,
  id: string,
  name: string | undefined,
): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  const existing = state.rooms.find((room) => room.floor === floor.id && room.id === id);
  if (!existing) return state;

  const updated: RoomDocument =
    name !== undefined
      ? { id: existing.id, name, floor: existing.floor, rects: existing.rects }
      : { id: existing.id, floor: existing.floor, rects: existing.rects };
  const rooms = upsertRoom(state.rooms, floor.id, id, updated);
  return applyRoomMutation(state, rooms, { floor: floor.id, id, before: existing, after: updated });
}

/** Appends `rect` to the room `id` on the ACTIVE floor's own rect list (a room may carry >=1 rects, e.g. an L-shaped footprint). Ignored mid-stroke. A safe no-op if no room with that id exists on the active floor. */
export function addRoomRect(state: PainterState, id: string, rect: RoomRect): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  const existing = state.rooms.find((room) => room.floor === floor.id && room.id === id);
  if (!existing) return state;

  const updated: RoomDocument = { ...existing, rects: [...existing.rects, rect] };
  const rooms = upsertRoom(state.rooms, floor.id, id, updated);
  return applyRoomMutation(state, rooms, { floor: floor.id, id, before: existing, after: updated });
}

/** Removes `rects[rectIndex]` from the room `id` on the ACTIVE floor. Ignored mid-stroke. A safe no-op if no room with that id exists on the active floor, `rectIndex` is out of range, OR removing it would leave the room with zero rects (schema requires >=1 -- use `removeRoom` to delete the whole room instead). */
export function removeRoomRect(state: PainterState, id: string, rectIndex: number): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  const existing = state.rooms.find((room) => room.floor === floor.id && room.id === id);
  if (!existing) return state;
  if (rectIndex < 0 || rectIndex >= existing.rects.length) return state;
  if (existing.rects.length <= 1) return state;

  const rects = existing.rects.filter((_, i) => i !== rectIndex);
  const updated: RoomDocument = { ...existing, rects };
  const rooms = upsertRoom(state.rooms, floor.id, id, updated);
  return applyRoomMutation(state, rooms, { floor: floor.id, id, before: existing, after: updated });
}

export interface RoomCommandStepOutcome {
  readonly state: PainterState;
  readonly command?: RoomCommand;
}

/** Undoes the most recent room command on the ACTIVE floor's OWN `roomCommandStack`, if any -- never a different floor's (spec: "per-floor undo isolation", same guarantee as `undo` for tile edits). */
export function undoRoom(state: PainterState): RoomCommandStepOutcome {
  const floor = activeFloorState(state);
  const last = floor.roomCommandStack.undoStack[floor.roomCommandStack.undoStack.length - 1];
  if (!last) return { state };

  const rooms = upsertRoom(state.rooms, last.floor, last.id, last.before);
  const undoStack = floor.roomCommandStack.undoStack.slice(0, -1);
  const redoStack = [...floor.roomCommandStack.redoStack, last].slice(-COMMAND_STACK_CAP);
  const withStack = replaceActiveFloor(state, { roomCommandStack: { undoStack, redoStack } });
  return { state: { ...withStack, rooms }, command: last };
}

/** Re-applies the most recently undone room command on the ACTIVE floor's OWN `roomCommandStack`, if any. */
export function redoRoom(state: PainterState): RoomCommandStepOutcome {
  const floor = activeFloorState(state);
  const last = floor.roomCommandStack.redoStack[floor.roomCommandStack.redoStack.length - 1];
  if (!last) return { state };

  const rooms = upsertRoom(state.rooms, last.floor, last.id, last.after);
  const redoStack = floor.roomCommandStack.redoStack.slice(0, -1);
  const undoStack = [...floor.roomCommandStack.undoStack, last].slice(-COMMAND_STACK_CAP);
  const withStack = replaceActiveFloor(state, { roomCommandStack: { undoStack, redoStack } });
  return { state: { ...withStack, rooms }, command: last };
}

// --- Stroke -> touched-cells resolution (per tool) ----------------------

function computeStrokeTouchedCells(
  stroke: ToolSMStrokingState,
  layers: TileLayerSet,
  width: number,
  height: number,
): readonly TilePoint[] {
  switch (stroke.tool) {
    case 'brush':
      return dedupeCells(stroke.points);
    case 'box-fill': {
      const last = stroke.points[stroke.points.length - 1] ?? {
        x: stroke.startX,
        y: stroke.startY,
      };
      return rectCells(stroke.startX, stroke.startY, last.x, last.y, width, height);
    }
    case 'flood-fill': {
      const layer = layers[stroke.layer] ?? [];
      return floodFillCells(layer, width, height, stroke.startX, stroke.startY);
    }
    case 'eyedropper':
      // Eyedropper never reaches here: `pointerDown` short-circuits it
      // before a stroke is ever begun (see this module's doc comment).
      return [];
  }
}

function dedupeCells(points: readonly TilePoint[]): TilePoint[] {
  const seen = new Set<string>();
  const result: TilePoint[] = [];
  for (const point of points) {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

// Left as plain positional params (not a parameter object, unlike
// `createPainterState`/`composeMapFromTilesets`): both `rectCells` and
// `floodFillCells` below are private, single-caller helpers local to this
// module -- the object-literal ceremony isn't worth it for call sites that
// never move or get re-ordered.
function rectCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
): TilePoint[] {
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(width - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(height - 1, Math.max(y0, y1));
  const cells: TilePoint[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/** Standard 4-connected flood fill: every cell reachable from `(startX, startY)` through cells sharing its exact tile id. */
function floodFillCells(
  layer: readonly number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
): TilePoint[] {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return [];

  const startIndex = startY * width + startX;
  const targetValue = layer[startIndex] ?? 0;
  const visited = new Uint8Array(width * height);
  visited[startIndex] = 1;

  const cells: TilePoint[] = [];
  const stack: TilePoint[] = [{ x: startX, y: startY }];
  while (stack.length > 0) {
    const point = stack.pop();
    if (!point) break;
    cells.push(point);

    const neighbors: readonly TilePoint[] = [
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 },
    ];
    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= width || neighbor.y < 0 || neighbor.y >= height) {
        continue;
      }
      const index = neighbor.y * width + neighbor.x;
      if (visited[index]) continue;
      if ((layer[index] ?? 0) !== targetValue) continue;
      visited[index] = 1;
      stack.push(neighbor);
    }
  }
  return cells;
}

function buildTileDiff(
  cells: readonly TilePoint[],
  layer: readonly number[],
  width: number,
  layerIndex: 0 | 1 | 2 | 3,
  fillTileId: number,
): TileDiff | undefined {
  const diffCells: TileCellDiff[] = [];
  for (const cell of cells) {
    const before = layer[cell.y * width + cell.x] ?? 0;
    if (before === fillTileId) continue;
    diffCells.push({ x: cell.x, y: cell.y, before, after: fillTileId });
  }
  if (diffCells.length === 0) return undefined;
  return { layer: layerIndex, cells: diffCells };
}
