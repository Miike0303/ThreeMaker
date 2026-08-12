/**
 * Painter tool state machine (Slice 4 design: "State machine: idle ->
 * stroking(pointerdown, capture) -> idle(pointerup commits)"). Pure, no
 * DOM/rendering coupling -- `painter-store.ts` wires this to `TileDiff`
 * computation and the undo/redo command stack.
 *
 * Autotile neighbor-rule shape resolution (design's autotile-paint.ts) is
 * intentionally out of scope this slice -- brush/box-fill/flood-fill place
 * the literal active tile id, no automatic blending.
 */

export type ToolId =
  | 'brush'
  | 'box-fill'
  | 'flood-fill'
  | 'eyedropper'
  | 'room-box'
  | 'stair-link'
  | 'spawn-point'
  | 'prop'
  | 'npc'
  | 'trigger'
  | 'light';

/**
 * Unity Tile Palette-style shortcuts (design: "B/U/G-style shortcuts"), plus
 * "I" for eyedropper, "R" for the room-box tool (Slice 5b: techos-y-
 * oclusion-interiores -- drags a rectangle to author a `RoomRect`, same
 * drag-a-box gesture as box-fill, see `painter-store.ts`'s
 * `commitRoomBoxStroke`), "S"/"P" for the stair-link/spawn-point tools
 * (Slice 5b: loop-crear-jugar -- both are single-click tools, not drags; see
 * `painter-store.ts`'s `pointerDown` for how they short-circuit the stroking
 * state machine entirely, the same way `eyedropper` does), "O" for the
 * prop tool (C5 WU-04 depth-props-hd -- single-click place of an ingested
 * `.glb` object, same short-circuit shape as spawn-point), "N"/"T" for
 * the NPC/trigger tools (c1a follow-up -- single-click place, same
 * short-circuit shape as prop/spawn-point), and "L" for the light tool
 * (schema v6 placed point/spot lights).
 *
 * PLAN_DEV_2 C2: these are **editor tool ids**, not remappable game
 * `ActionId`s from `@threemaker/input`. Pointer paint strokes and palette
 * shortcuts stay host-local; the shared input package is for play-time
 * actions (move/interact/view), not for map-authoring tools.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  b: 'brush',
  u: 'box-fill',
  g: 'flood-fill',
  i: 'eyedropper',
  r: 'room-box',
  s: 'stair-link',
  p: 'spawn-point',
  o: 'prop',
  n: 'npc',
  t: 'trigger',
  l: 'light',
};

/** Resolves a keyboard event's `key` (case-insensitive) to a tool, or `undefined` if it isn't a tool shortcut. */
export function resolveToolShortcut(key: string): ToolId | undefined {
  return TOOL_SHORTCUTS[key.toLowerCase()];
}

/** Structural stand-in for a keydown `event.target` element, so the guard stays pure/unit-testable with no DOM dependency. */
export interface EditableTargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

export interface ShortcutModifiers {
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when a bare-letter tool shortcut must NOT fire (WU-UX-02): the key
 * event targets a text-entry element (input/textarea/select/contentEditable
 * -- typing "b" in the map-name field is text, not a tool switch), or a
 * ctrl/meta/alt modifier is held (those belong to editor chords, see
 * `resolveEditorChord`, or to the browser).
 */
export function shouldIgnoreToolShortcut(
  target: EditableTargetLike | null | undefined,
  modifiers: ShortcutModifiers,
): boolean {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return true;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName !== undefined && EDITABLE_TAGS.has(target.tagName.toUpperCase());
}

export type EditorChord = 'undo' | 'redo' | 'save' | 'cancel';

/** Structural stand-in for the chord-relevant fields of a `KeyboardEvent`, keeping `resolveEditorChord` pure/unit-testable. */
export interface ChordEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Resolves editor-level keyboard chords (WU-UX-03): Ctrl/Cmd+Z = undo,
 * Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo, Ctrl/Cmd+S = save, Escape = cancel
 * (no modifier). Anything else is `null` -- notably every bare letter, which
 * stays in `resolveToolShortcut`'s namespace.
 */
export function resolveEditorChord(event: ChordEventLike): EditorChord | null {
  if (event.key === 'Escape') return 'cancel';
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  if (key === 's') return 'save';
  return null;
}

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

export interface ToolSMIdleState {
  readonly status: 'idle';
}

export interface ToolSMStrokingState {
  readonly status: 'stroking';
  readonly tool: ToolId;
  readonly layer: 0 | 1 | 2 | 3;
  readonly startX: number;
  readonly startY: number;
  /** Every distinct point the stroke has passed over, in order, start included. */
  readonly points: readonly TilePoint[];
}

export type ToolSMState = ToolSMIdleState | ToolSMStrokingState;

export const TOOL_SM_IDLE: ToolSMIdleState = { status: 'idle' };

/** idle -> stroking, capturing the pointer-down point (`pointerdown, capture` in the design). No-op (returns the same state) if already stroking -- a second pointerdown before pointerup is ignored, not restarted. */
export function beginStroke(
  state: ToolSMState,
  tool: ToolId,
  layer: 0 | 1 | 2 | 3,
  point: TilePoint,
): ToolSMState {
  if (state.status === 'stroking') return state;
  return { status: 'stroking', tool, layer, startX: point.x, startY: point.y, points: [point] };
}

/** stroking -> stroking, appending a point (deduping an exact repeat of the last point). No-op while idle -- pointer moves before a pointerdown don't affect anything. */
export function continueStroke(state: ToolSMState, point: TilePoint): ToolSMState {
  if (state.status !== 'stroking') return state;
  const last = state.points[state.points.length - 1];
  if (last && last.x === point.x && last.y === point.y) return state;
  return { ...state, points: [...state.points, point] };
}

/** stroking -> idle ("pointerup commits" in the design). Idle if called while already idle. */
export function endStroke(_state: ToolSMState): ToolSMIdleState {
  return TOOL_SM_IDLE;
}
