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
 *
 * Stair-link + spawn authoring (Slice 5a, loop-crear-jugar): `PainterState.
 * stairLinks` mirrors `MapDocument.stairLinks` exactly (flat, top-level,
 * unlike rooms/tiles it is NOT floor-scoped -- a `StairLinkDocument`
 * inherently spans two floors via `fromFloor`/`toFloor`). Deliberately NO
 * command-stack undo for stair-links or spawn, unlike rooms/tiles: a
 * stair-link references TWO floors at once, so there is no single "active
 * floor's own stack" to push it onto without breaking the "per-floor undo
 * isolation" invariant the rest of this module enforces (see `undo`/
 * `undoRoom`'s doc comments) -- deleting a link (`removeStairLink`) or
 * overwriting the single `spawn` value (`setSpawn`/`clearSpawn`) IS the
 * undo, mirroring `activeRoomId`'s plain caller-driven state, not
 * `roomCommandStack`'s push/pop history.
 */

import type {
  CommandStackState,
  MapSpawn,
  RoomDocument,
  RoomRect,
  SemanticClass,
  SemanticOverrides,
  StairLinkDocument,
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
  /**
   * The room id the next 'room-box' stroke extends (via `addRoomRect`)
   * instead of creating a brand-new room (Slice 5b: `commitRoomBoxStroke`).
   * `undefined` means the next stroke authors a brand-new room. Caller-set
   * only via `setActiveRoomId` -- mirrors `addFloor`'s caller-supplied id,
   * the store never invents room ids itself. Cleared automatically by
   * `removeRoom` when it targets the currently active room.
   */
  readonly activeRoomId?: string;
  /** Every authored stair-link (Slice 5a), mirroring `MapDocument.stairLinks` exactly -- flat, top-level, NOT floor-scoped (a link inherently spans two floors). */
  readonly stairLinks: readonly StairLinkDocument[];
  /**
   * The first click's entry point in the 2-click stair-link authoring flow
   * (Slice 5b tool drives this; the store only holds/clears the value --
   * see this module's doc comment). `undefined` means no click is pending.
   * Caller-set only via `setPendingStairEntry`, mirroring `activeRoomId`.
   */
  readonly pendingStairEntry?: { readonly floor: string; readonly x: number; readonly y: number };
  /** The single authored player-spawn point (Slice 5a), mirroring `MapDocument.spawn` exactly. `undefined` means unauthored (runtime falls back to `findSpawnTile`). */
  readonly spawn?: MapSpawn;
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
  /** Initial stair-links (map load path), matching `MapDocument.stairLinks`; defaults to none authored. */
  readonly stairLinks?: readonly StairLinkDocument[];
  /** Initial spawn (map load path), matching `MapDocument.spawn`; defaults to unauthored. */
  readonly spawn?: MapSpawn;
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
    stairLinks = [],
    spawn,
  } = options;
  const base: PainterState = {
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
    stairLinks,
  };
  return spawn === undefined ? base : { ...base, spawn };
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

/**
 * Sets (or, with `undefined`, clears) the room the next 'room-box' stroke
 * extends (Slice 5b). Ignored mid-stroke, same as `setTool`.
 * `exactOptionalPropertyTypes` requires actually OMITTING the key to clear
 * it (assigning `activeRoomId: undefined` is a type error), hence the
 * destructure-to-omit branch below rather than a plain spread.
 */
export function setActiveRoomId(state: PainterState, id: string | undefined): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (id !== undefined) return { ...state, activeRoomId: id };
  if (state.activeRoomId === undefined) return state;
  const { activeRoomId: _activeRoomId, ...rest } = state;
  return rest;
}

export interface PointerDownResult {
  readonly state: PainterState;
  /** Set only for the eyedropper tool, which picks immediately and never enters "stroking". */
  readonly pickedTileId?: number;
}

export interface PointerDownOptions {
  /**
   * Caller-supplied id for the stair-link the SECOND 'stair-link' click
   * creates (Slice 5b), mirroring 'room-box'/`pointerUp`'s caller-supplied
   * `newRoomId` -- the store never invents ids itself. Ignored on the FIRST
   * click of the 2-click flow (which only records `pendingStairEntry`) and
   * for every other tool.
   */
  readonly newStairLinkId?: string;
}

/**
 * `pointerdown`: eyedropper picks immediately (no stroke) from the active
 * floor; 'spawn-point' and 'stair-link' (Slice 5b) also act immediately with
 * no stroke, same short-circuit shape as eyedropper; every other tool begins
 * a stroke.
 */
export function pointerDown(
  state: PainterState,
  point: TilePoint,
  options: PointerDownOptions = {},
): PointerDownResult {
  if (state.tool === 'eyedropper') {
    const floor = activeFloorState(state);
    const layer = floor.layers[state.activeLayer];
    const pickedTileId = layer?.[point.y * state.width + point.x] ?? 0;
    return { state, pickedTileId };
  }
  if (state.tool === 'spawn-point') {
    const floor = activeFloorState(state);
    return { state: setSpawn(state, { x: point.x, y: point.y, floor: floor.id }) };
  }
  if (state.tool === 'stair-link') {
    return { state: handleStairLinkClick(state, point, options.newStairLinkId) };
  }
  const stroke = beginStroke(state.stroke, state.tool, state.activeLayer, point);
  return { state: { ...state, stroke } };
}

/**
 * Drives the 2-click stair-link authoring flow (Slice 5b design: "click
 * entry tile on active floor -> switch floor (existing switcher) -> click
 * exit tile"). The FIRST click with no pending entry only records it
 * (`setPendingStairEntry`, using the CURRENTLY active floor as `fromFloor`).
 * The SECOND click creates the link via `addStairLink`, using the pending
 * entry as the `fromFloor`/entry point and whichever floor is active NOW as
 * `toFloor`/exit (the caller is expected to have switched floors via
 * `selectFloor` in between, though this function does not itself enforce a
 * DIFFERENT floor -- the schema does not forbid `fromFloor === toFloor`
 * either), then clears the pending entry either way. A safe no-op that
 * stays mid-flow (pending entry NOT cleared) if the second click arrives
 * without a caller-supplied `newStairLinkId` -- mirrors
 * `commitRoomBoxStroke`'s own newRoomId-absent no-op.
 */
function handleStairLinkClick(
  state: PainterState,
  point: TilePoint,
  newStairLinkId: string | undefined,
): PainterState {
  const floor = activeFloorState(state);
  if (state.pendingStairEntry === undefined) {
    return setPendingStairEntry(state, { floor: floor.id, x: point.x, y: point.y });
  }
  if (!newStairLinkId) return state;

  const pending = state.pendingStairEntry;
  const added = addStairLink(state, {
    id: newStairLinkId,
    fromFloor: pending.floor,
    toFloor: floor.id,
    entry: { x: pending.x, y: pending.y },
    exit: { x: point.x, y: point.y },
  });
  return setPendingStairEntry(added, undefined);
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

export interface PointerUpOptions {
  /**
   * Room id a 'room-box' stroke authors into when no room is currently
   * active (`state.activeRoomId === undefined`) -- i.e. a brand-new room
   * (Slice 5b). Caller-supplied (mirrors `addFloor`'s caller-supplied id:
   * the store stays pure/deterministic and never invents ids itself).
   * Ignored for every other tool, and ignored when an active room already
   * exists on the active floor (the stroke extends it via `addRoomRect`
   * instead -- see `commitRoomBoxStroke`).
   */
  readonly newRoomId?: string;
}

/** `pointerup`: commits the in-progress stroke onto the ACTIVE floor only (spec: "editing the active floor only"). A 'room-box' stroke authors/extends a room instead of painting tiles (see `commitRoomBoxStroke`). In semantic mode, assigns the active semantic class to every distinct tile id touched (no layer/diff change, and NOT part of the per-floor tile undo history). Otherwise computes the stroke's touched cells, builds a `TileDiff`, applies it to the active floor's layers, and pushes it onto the active floor's OWN command stack. No-op while idle. */
export function pointerUp(state: PainterState, options: PointerUpOptions = {}): PointerUpResult {
  if (state.stroke.status !== 'stroking') return { state };

  const stroke = state.stroke;
  const idleState: PainterState = { ...state, stroke: endStroke(state.stroke) };

  if (stroke.tool === 'room-box') {
    return commitRoomBoxStroke(idleState, stroke, options.newRoomId);
  }

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

/** Removes the room `id` from the ACTIVE floor. Ignored mid-stroke. A safe no-op if no room with that id exists on the active floor. Also clears `activeRoomId` (Slice 5b) when it pointed at the removed room -- otherwise the next room-box stroke would silently try to extend a room that no longer exists. */
export function removeRoom(state: PainterState, id: string): PainterState {
  if (state.stroke.status === 'stroking') return state;
  const floor = activeFloorState(state);
  const existing = state.rooms.find((room) => room.floor === floor.id && room.id === id);
  if (!existing) return state;

  const rooms = upsertRoom(state.rooms, floor.id, id, undefined);
  const mutated = applyRoomMutation(state, rooms, { floor: floor.id, id, before: existing });
  return mutated.activeRoomId === id ? setActiveRoomId(mutated, undefined) : mutated;
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

/** The single `RoomRect` a 'room-box' stroke authors (Slice 5b): the inclusive bounding box between the stroke's start point and its last point, clamped to the map bounds -- the exact same inclusive-bounds convention as `rectCells`, the box-fill tool's own bounding-box resolution below. A stroke with no movement (pointerdown immediately followed by pointerup) still yields a valid 1x1 rect. */
function resolveRoomBoxRect(stroke: ToolSMStrokingState, width: number, height: number): RoomRect {
  const last = stroke.points[stroke.points.length - 1] ?? { x: stroke.startX, y: stroke.startY };
  const minX = Math.max(0, Math.min(stroke.startX, last.x));
  const maxX = Math.min(width - 1, Math.max(stroke.startX, last.x));
  const minY = Math.max(0, Math.min(stroke.startY, last.y));
  const maxY = Math.min(height - 1, Math.max(stroke.startY, last.y));
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Commits a 'room-box' stroke (Slice 5b). `idleState` already has the
 * stroke ended (`endStroke`, done by the caller, `pointerUp`). Extends
 * `idleState.activeRoomId`'s rects via `addRoomRect` when that room still
 * exists on the active floor; otherwise authors a brand-new room via
 * `addRoom` using the caller-supplied `newRoomId` (a safe no-op if
 * `newRoomId` is absent -- there is nothing to create). Either way, the
 * resulting room becomes the new active room, so consecutive drags extend
 * the SAME room by default (continuous multi-rect authoring, e.g. an
 * L-shaped footprint) until the panel's "new room" action clears
 * `activeRoomId` again.
 */
function commitRoomBoxStroke(
  idleState: PainterState,
  stroke: ToolSMStrokingState,
  newRoomId: string | undefined,
): PointerUpResult {
  const rect = resolveRoomBoxRect(stroke, idleState.width, idleState.height);
  const floor = activeFloorState(idleState);
  const existing =
    idleState.activeRoomId !== undefined
      ? idleState.rooms.find(
          (room) => room.floor === floor.id && room.id === idleState.activeRoomId,
        )
      : undefined;

  if (existing) {
    return { state: addRoomRect(idleState, existing.id, rect) };
  }
  if (!newRoomId) return { state: idleState };

  const added = addRoom(idleState, { id: newRoomId, rects: [rect] });
  return { state: setActiveRoomId(added, newRoomId) };
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

// --- Stair-link authoring (Slice 5a) -------------------------------------

export interface AddStairLinkOptions {
  readonly id: string;
  readonly fromFloor: string;
  readonly toFloor: string;
  /** The entry point, on `fromFloor`. Becomes `waypoints[0]`. */
  readonly entry: { readonly x: number; readonly y: number };
  /** The landing point, on `toFloor`. Becomes the last waypoint. */
  readonly exit: { readonly x: number; readonly y: number };
  /** Defaults to `true` (design: "bidirectional: true default"). */
  readonly bidirectional?: boolean;
}

/**
 * Adds a new 2-waypoint `StairLinkDocument` connecting `fromFloor`'s `entry`
 * tile to `toFloor`'s `exit` tile (design: "waypoints[0] is the entry point
 * on fromFloor, the last is the landing on toFloor"). Ignored mid-stroke,
 * same as `setTool`. A no-op if a link with `options.id` already exists --
 * stair-link ids are store-level unique (schema itself does not enforce
 * this, unlike floor/room ids, but CRUD-by-id requires it); use
 * `removeStairLink` + `addStairLink` to replace one instead. NOT part of
 * any command-stack undo history -- see this module's doc comment.
 */
export function addStairLink(state: PainterState, options: AddStairLinkOptions): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (state.stairLinks.some((link) => link.id === options.id)) return state;

  const link: StairLinkDocument = {
    id: options.id,
    fromFloor: options.fromFloor,
    toFloor: options.toFloor,
    bidirectional: options.bidirectional ?? true,
    waypoints: [
      { x: options.entry.x, y: options.entry.y, floor: options.fromFloor },
      { x: options.exit.x, y: options.exit.y, floor: options.toFloor },
    ],
  };
  return { ...state, stairLinks: [...state.stairLinks, link] };
}

/** Removes the stair-link `id`. Ignored mid-stroke. A safe no-op if no link with that id exists -- this IS the undo for stair-link authoring (see this module's doc comment). */
export function removeStairLink(state: PainterState, id: string): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (!state.stairLinks.some((link) => link.id === id)) return state;
  return { ...state, stairLinks: state.stairLinks.filter((link) => link.id !== id) };
}

/** Flips the `bidirectional` flag on the stair-link `id`. Ignored mid-stroke. A safe no-op if no link with that id exists. */
export function toggleStairLinkBidirectional(state: PainterState, id: string): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (!state.stairLinks.some((link) => link.id === id)) return state;
  const stairLinks = state.stairLinks.map((link) =>
    link.id === id ? { ...link, bidirectional: !link.bidirectional } : link,
  );
  return { ...state, stairLinks };
}

/**
 * Sets (or, with `undefined`, clears) the pending entry point in the 2-click
 * stair-link authoring flow (Slice 5b's tool drives the actual clicks; this
 * store op only holds/clears the value). Ignored mid-stroke, same as
 * `setTool`. Mirrors `setActiveRoomId`'s omit-to-clear shape
 * (`exactOptionalPropertyTypes` requires actually omitting the key).
 */
export function setPendingStairEntry(
  state: PainterState,
  entry: { readonly floor: string; readonly x: number; readonly y: number } | undefined,
): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (entry !== undefined) return { ...state, pendingStairEntry: entry };
  if (state.pendingStairEntry === undefined) return state;
  const { pendingStairEntry: _pendingStairEntry, ...rest } = state;
  return rest;
}

// --- Spawn authoring (Slice 5a) ------------------------------------------

/** Sets the player-spawn point, replacing any existing one (single spawn per map). Ignored mid-stroke, same as `setTool`. NOT part of any command-stack undo history -- overwriting/clearing IS the undo (see this module's doc comment). */
export function setSpawn(state: PainterState, spawn: MapSpawn): PainterState {
  if (state.stroke.status === 'stroking') return state;
  return { ...state, spawn };
}

/** Clears the player-spawn point. Ignored mid-stroke. A safe no-op if no spawn is set. */
export function clearSpawn(state: PainterState): PainterState {
  if (state.stroke.status === 'stroking') return state;
  if (state.spawn === undefined) return state;
  const { spawn: _spawn, ...rest } = state;
  return rest;
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
    case 'stair-link':
    case 'spawn-point':
      // Never reached: `pointerDown` short-circuits both tools before a
      // stroke is ever begun (Slice 5b), same as 'eyedropper' above.
      return [];
    case 'room-box':
      // Never reached: `pointerUp` short-circuits a 'room-box' stroke into
      // `commitRoomBoxStroke` before this function is ever called (see
      // this module's Room CRUD section).
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
