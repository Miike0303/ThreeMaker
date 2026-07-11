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

export type ToolId = 'brush' | 'box-fill' | 'flood-fill' | 'eyedropper';

/** Unity Tile Palette-style shortcuts (design: "B/U/G-style shortcuts"), plus "I" for eyedropper. */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  b: 'brush',
  u: 'box-fill',
  g: 'flood-fill',
  i: 'eyedropper',
};

/** Resolves a keyboard event's `key` (case-insensitive) to a tool, or `undefined` if it isn't a tool shortcut. */
export function resolveToolShortcut(key: string): ToolId | undefined {
  return TOOL_SHORTCUTS[key.toLowerCase()];
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
