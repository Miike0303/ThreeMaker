/**
 * Undo/redo model for tile-painting edits (Slice 4 design: "Undo/redo =
 * command stack of TileDiffs (invert = swap before/after), cap 100"). Pure,
 * browser-safe -- no rendering/IO here; the editor store wires this to
 * `patchChunks` (see `apps/editor`).
 */

/** One cell's before/after tile id at a map coordinate. */
export interface TileCellDiff {
  readonly x: number;
  readonly y: number;
  readonly before: number;
  readonly after: number;
}

/** One stroke's full edit set on a single layer, ready to apply or invert. */
export interface TileDiff {
  readonly layer: 0 | 1 | 2 | 3;
  readonly cells: readonly TileCellDiff[];
}

/** The 4 editable tile layers, row-major, length `width * height` each. */
export type TileLayerSet = readonly [
  readonly number[],
  readonly number[],
  readonly number[],
  readonly number[],
];

/** Swaps every cell's before/after -- applying an inverted diff undoes the original. */
export function invertTileDiff(diff: TileDiff): TileDiff {
  return {
    layer: diff.layer,
    cells: diff.cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      before: cell.after,
      after: cell.before,
    })),
  };
}

/**
 * Applies `diff` to `layers`, returning a new `TileLayerSet` with only the
 * touched layer's array actually cloned (the other 3 layers keep their
 * original array reference -- cheap for callers that only care about the
 * touched layer changing identity, e.g. a memoized renderer input).
 */
export function applyTileDiff(layers: TileLayerSet, width: number, diff: TileDiff): TileLayerSet {
  const touchedSource = layers[diff.layer];
  const touched = touchedSource.slice();
  for (const cell of diff.cells) {
    touched[cell.y * width + cell.x] = cell.after;
  }
  const next = [...layers] as [number[], number[], number[], number[]];
  next[diff.layer] = touched;
  return next;
}

/** `applyTileDiff` with the diff inverted first -- the literal "undo" operation. */
export function applyInverseTileDiff(
  layers: TileLayerSet,
  width: number,
  diff: TileDiff,
): TileLayerSet {
  return applyTileDiff(layers, width, invertTileDiff(diff));
}

/** Command-stack cap: the oldest entry is dropped once both stacks combined would exceed this per side. */
export const COMMAND_STACK_CAP = 100;

export interface CommandStackState {
  readonly undoStack: readonly TileDiff[];
  readonly redoStack: readonly TileDiff[];
}

export const EMPTY_COMMAND_STACK: CommandStackState = { undoStack: [], redoStack: [] };

/** Pushes a newly-committed stroke's diff. Clears the redo stack (a fresh edit invalidates any redo history), and caps the undo stack at `COMMAND_STACK_CAP`. */
export function pushCommand(state: CommandStackState, diff: TileDiff): CommandStackState {
  const undoStack = [...state.undoStack, diff].slice(-COMMAND_STACK_CAP);
  return { undoStack, redoStack: [] };
}

export interface CommandStepResult {
  readonly state: CommandStackState;
  /** The diff to apply (already oriented correctly: inverted for undo, as-is for redo) to move the map to its new state. */
  readonly diff: TileDiff;
}

/** Pops the most recent undo entry (if any), moving it to the redo stack, and returns the INVERTED diff to apply. */
export function undoCommand(state: CommandStackState): CommandStepResult | null {
  const last = state.undoStack[state.undoStack.length - 1];
  if (!last) return null;
  const undoStack = state.undoStack.slice(0, -1);
  const redoStack = [...state.redoStack, last].slice(-COMMAND_STACK_CAP);
  return { state: { undoStack, redoStack }, diff: invertTileDiff(last) };
}

/** Pops the most recent redo entry (if any), moving it back to the undo stack, and returns the diff to re-apply as-is. */
export function redoCommand(state: CommandStackState): CommandStepResult | null {
  const last = state.redoStack[state.redoStack.length - 1];
  if (!last) return null;
  const redoStack = state.redoStack.slice(0, -1);
  const undoStack = [...state.undoStack, last].slice(-COMMAND_STACK_CAP);
  return { state: { undoStack, redoStack }, diff: last };
}
