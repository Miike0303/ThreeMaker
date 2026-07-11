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
 */

import type {
  CommandStackState,
  SemanticClass,
  SemanticOverrides,
  TileCellDiff,
  TileDiff,
  TileLayerSet,
} from '@threemaker/map-format';
import {
  applyTileDiff,
  EMPTY_COMMAND_STACK,
  pushCommand,
  redoCommand,
  undoCommand,
} from '@threemaker/map-format';
import { assignSemanticClass, resolveTouchedTileIds } from './semantic-store.js';
import type { TilePoint, ToolId, ToolSMState, ToolSMStrokingState } from './tool-sm.js';
import { beginStroke, continueStroke, endStroke, TOOL_SM_IDLE } from './tool-sm.js';

export interface PainterState {
  readonly layers: TileLayerSet;
  readonly width: number;
  readonly height: number;
  readonly tool: ToolId;
  readonly activeLayer: 0 | 1 | 2 | 3;
  /** The tile id every non-eyedropper tool paints; 0 = eraser. */
  readonly fillTileId: number;
  readonly stroke: ToolSMState;
  readonly commandStack: CommandStackState;
  /** When true, a committed stroke assigns `semanticClass` to every distinct tile id it touches instead of painting -- the visual tile layer is never modified (spec: "Semantic-only edit"). */
  readonly semanticMode: boolean;
  readonly semanticClass: SemanticClass;
  readonly semantics: SemanticOverrides;
}

export function createPainterState(
  layers: TileLayerSet,
  width: number,
  height: number,
  fillTileId = 0,
  semantics: SemanticOverrides = {},
): PainterState {
  return {
    layers,
    width,
    height,
    tool: 'brush',
    activeLayer: 0,
    fillTileId,
    stroke: TOOL_SM_IDLE,
    commandStack: EMPTY_COMMAND_STACK,
    semanticMode: false,
    semanticClass: 'none',
    semantics,
  };
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

/** `pointerdown`: eyedropper picks immediately (no stroke); every other tool begins a stroke. */
export function pointerDown(state: PainterState, point: TilePoint): PointerDownResult {
  if (state.tool === 'eyedropper') {
    const layer = state.layers[state.activeLayer];
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

/** `pointerup`: commits the in-progress stroke. In semantic mode, assigns the active semantic class to every distinct tile id touched (no layer/diff change). Otherwise computes the stroke's touched cells, builds a `TileDiff`, applies it, and pushes it onto the undo stack. No-op while idle. */
export function pointerUp(state: PainterState): PointerUpResult {
  if (state.stroke.status !== 'stroking') return { state };

  const stroke = state.stroke;
  const idleState: PainterState = { ...state, stroke: endStroke(state.stroke) };

  const cells = computeStrokeTouchedCells(stroke, state.layers, state.width, state.height);
  const layer = state.layers[stroke.layer];
  if (!layer) return { state: idleState };

  if (state.semanticMode) {
    const tileIds = resolveTouchedTileIds(cells, layer, state.width);
    if (tileIds.size === 0) return { state: idleState };
    const semantics = assignSemanticClass(state.semantics, tileIds, state.semanticClass);
    return { state: { ...idleState, semantics }, semanticTileIds: tileIds };
  }

  const diff = buildTileDiff(cells, layer, state.width, stroke.layer, state.fillTileId);
  if (!diff) return { state: idleState };

  const layers = applyTileDiff(state.layers, state.width, diff);
  const commandStack = pushCommand(state.commandStack, diff);
  return { state: { ...idleState, layers, commandStack }, diff };
}

export interface CommandStepOutcome {
  readonly state: PainterState;
  readonly diff?: TileDiff;
}

/** Undoes the most recent committed stroke, if any. */
export function undo(state: PainterState): CommandStepOutcome {
  const result = undoCommand(state.commandStack);
  if (!result) return { state };
  const layers = applyTileDiff(state.layers, state.width, result.diff);
  return { state: { ...state, layers, commandStack: result.state }, diff: result.diff };
}

/** Re-applies the most recently undone stroke, if any. */
export function redo(state: PainterState): CommandStepOutcome {
  const result = redoCommand(state.commandStack);
  if (!result) return { state };
  const layers = applyTileDiff(state.layers, state.width, result.diff);
  return { state: { ...state, layers, commandStack: result.state }, diff: result.diff };
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
