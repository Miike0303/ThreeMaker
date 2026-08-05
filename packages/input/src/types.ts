/**
 * Logical input actions shared by desktop, editor, and (later) mobile.
 * Device-specific codes never leave the adapters — gameplay only sees ActionIds.
 */

/** Opaque action identifier. Well-known defaults live in {@link Actions}. */
export type ActionId = string;

/** Well-known action ids extracted from the desktop keyboard seams. */
export const Actions = {
  MoveUp: 'move.up',
  MoveDown: 'move.down',
  MoveLeft: 'move.left',
  MoveRight: 'move.right',
  Interact: 'interact',
  ViewTogglePostProcessing: 'view.togglePostProcessing',
  ViewCycleCamera: 'view.cycleCamera',
  ViewTiltDown: 'view.tiltDown',
  ViewTiltUp: 'view.tiltUp',
  ViewZoomOut: 'view.zoomOut',
  ViewZoomIn: 'view.zoomIn',
  ViewNoclip: 'view.noclip',
} as const;

/**
 * Device source that can fire an action. WU-01 only models keyboard;
 * gamepad and pointer land in later work units on the same shape.
 */
export type KeyboardSource = {
  readonly device: 'keyboard';
  /** Raw `KeyboardEvent.key` (any casing); stored/looked up lowercased. */
  readonly key: string;
};

export type DeviceSource = KeyboardSource;

/** One mapping from a device source to a logical action. */
export type ActionBinding = {
  readonly action: ActionId;
  readonly source: DeviceSource;
};

/**
 * Actions that stay active while the control is held (keydown → pressed,
 * keyup → released). One-shot actions only emit on the down edge.
 */
export const HOLD_ACTIONS: ReadonlySet<ActionId> = new Set([
  Actions.MoveUp,
  Actions.MoveDown,
  Actions.MoveLeft,
  Actions.MoveRight,
  Actions.ViewNoclip,
]);

/** Grid move directions produced by the move.* action family. */
export type MoveDirection = 'up' | 'down' | 'left' | 'right';

const MOVE_ACTION_TO_DIRECTION: Readonly<Record<string, MoveDirection>> = {
  [Actions.MoveUp]: 'up',
  [Actions.MoveDown]: 'down',
  [Actions.MoveLeft]: 'left',
  [Actions.MoveRight]: 'right',
};

/** Map a move.* action to a grid direction, or undefined when not a move action. */
export function directionFromMoveAction(action: ActionId | undefined): MoveDirection | undefined {
  if (action === undefined) return undefined;
  return MOVE_ACTION_TO_DIRECTION[action];
}
