import { describe, expect, it } from 'vitest';
import {
  applyInverseTileDiff,
  applyTileDiff,
  COMMAND_STACK_CAP,
  EMPTY_COMMAND_STACK,
  invertTileDiff,
  pushCommand,
  redoCommand,
  type TileDiff,
  type TileLayerSet,
  undoCommand,
} from '../src/tile-diff.js';

function makeLayers(width: number, height: number): TileLayerSet {
  const size = width * height;
  return [
    new Array(size).fill(0),
    new Array(size).fill(0),
    new Array(size).fill(0),
    new Array(size).fill(0),
  ];
}

describe('invertTileDiff', () => {
  it('swaps before/after on every cell, keeping the layer', () => {
    const diff: TileDiff = {
      layer: 1,
      cells: [
        { x: 0, y: 0, before: 5, after: 9 },
        { x: 1, y: 0, before: 0, after: 12 },
      ],
    };
    expect(invertTileDiff(diff)).toEqual({
      layer: 1,
      cells: [
        { x: 0, y: 0, before: 9, after: 5 },
        { x: 1, y: 0, before: 12, after: 0 },
      ],
    });
  });
});

describe('applyTileDiff / applyInverseTileDiff (property: apply then invert-apply is a no-op)', () => {
  it('applies a diff to only the targeted layer, cloning it but not the others', () => {
    const layers = makeLayers(2, 2);
    const diff: TileDiff = { layer: 2, cells: [{ x: 1, y: 1, before: 0, after: 42 }] };

    const next = applyTileDiff(layers, 2, diff);

    expect(next[2]?.[1 * 2 + 1]).toBe(42);
    expect(next[0]).toBe(layers[0]); // untouched layers keep identity
    expect(next[1]).toBe(layers[1]);
    expect(next[3]).toBe(layers[3]);
    expect(next[2]).not.toBe(layers[2]); // touched layer is a new array
  });

  it('applyInverseTileDiff undoes an applyTileDiff exactly, for any diff', () => {
    const layers = makeLayers(3, 3);
    const diff: TileDiff = {
      layer: 0,
      cells: [
        { x: 0, y: 0, before: 0, after: 7 },
        { x: 2, y: 2, before: 0, after: 3 },
      ],
    };

    const painted = applyTileDiff(layers, 3, diff);
    const restored = applyInverseTileDiff(painted, 3, diff);

    expect(restored).toEqual(layers);
  });
});

describe('multi-tileset roundtrip (paint from 2 tilesets, apply, restore)', () => {
  it('applying diffs sourced from two different slot compositions still restores byte-identical state via inversion', () => {
    // Simulates painting one map using tiles whose ids come from two
    // different catalog tilesets composed into different slots (A2 ground
    // from tileset A, B decor from tileset B) -- the diff model itself is
    // slot/tileset-agnostic (just tile ids), matching the design's per-slot
    // composition decision.
    const layers = makeLayers(4, 4);
    const groundFromTilesetA: TileDiff = {
      layer: 0,
      cells: [
        { x: 0, y: 0, before: 0, after: 2816 }, // A2 sheet base id
        { x: 1, y: 0, before: 0, after: 2817 },
      ],
    };
    const decorFromTilesetB: TileDiff = {
      layer: 2,
      cells: [{ x: 0, y: 0, before: 0, after: 69 }], // B sheet decor id
    };

    let state = applyTileDiff(layers, 4, groundFromTilesetA);
    state = applyTileDiff(state, 4, decorFromTilesetB);

    expect(state[0]?.[0]).toBe(2816);
    expect(state[0]?.[1]).toBe(2817);
    expect(state[2]?.[0]).toBe(69);

    // reload/restore path: undo both in reverse order returns byte-identical state
    let restored = applyInverseTileDiff(state, 4, decorFromTilesetB);
    restored = applyInverseTileDiff(restored, 4, groundFromTilesetA);
    expect(restored).toEqual(layers);
  });
});

describe('command stack (undo/redo, cap 100)', () => {
  function makeDiff(after: number): TileDiff {
    return { layer: 0, cells: [{ x: 0, y: 0, before: 0, after }] };
  }

  it('undo sequence: paint 5 tiles then undo 3 -> map reflects state after the first 2 paints', () => {
    let stack = EMPTY_COMMAND_STACK;
    let layers = makeLayers(1, 1);
    const diffs = [1, 2, 3, 4, 5].map(makeDiff);

    for (const diff of diffs) {
      // Each successive paint's "before" is whatever the previous paint left.
      const previousValue = layers[0]?.[0] ?? 0;
      const orientedDiff: TileDiff = {
        layer: diff.layer,
        cells: diff.cells.map((cell) => ({ ...cell, before: previousValue })),
      };
      layers = applyTileDiff(layers, 1, orientedDiff);
      stack = pushCommand(stack, orientedDiff);
    }
    expect(layers[0]?.[0]).toBe(5);

    for (let i = 0; i < 3; i++) {
      const result = undoCommand(stack);
      expect(result).not.toBeNull();
      if (!result) throw new Error('unreachable');
      stack = result.state;
      layers = applyTileDiff(layers, 1, result.diff);
    }

    expect(layers[0]?.[0]).toBe(2); // state after only the first 2 paints
    expect(stack.undoStack).toHaveLength(2);
    expect(stack.redoStack).toHaveLength(3);
  });

  it('redo re-applies an undone command and moves it back to the undo stack', () => {
    let stack = pushCommand(EMPTY_COMMAND_STACK, makeDiff(1));
    let layers = applyTileDiff(makeLayers(1, 1), 1, makeDiff(1));

    const undone = undoCommand(stack);
    if (!undone) throw new Error('unreachable');
    stack = undone.state;
    layers = applyTileDiff(layers, 1, undone.diff);
    expect(layers[0]?.[0]).toBe(0);

    const redone = redoCommand(stack);
    if (!redone) throw new Error('unreachable');
    stack = redone.state;
    layers = applyTileDiff(layers, 1, redone.diff);

    expect(layers[0]?.[0]).toBe(1);
    expect(stack.undoStack).toHaveLength(1);
    expect(stack.redoStack).toHaveLength(0);
  });

  it('pushing a new command clears the redo stack', () => {
    let stack = pushCommand(EMPTY_COMMAND_STACK, makeDiff(1));
    const undone = undoCommand(stack);
    if (!undone) throw new Error('unreachable');
    stack = undone.state;
    expect(stack.redoStack).toHaveLength(1);

    stack = pushCommand(stack, makeDiff(2));
    expect(stack.redoStack).toHaveLength(0);
  });

  it('undo/redo on an empty stack returns null without throwing', () => {
    expect(undoCommand(EMPTY_COMMAND_STACK)).toBeNull();
    expect(redoCommand(EMPTY_COMMAND_STACK)).toBeNull();
  });

  it('caps the undo stack at COMMAND_STACK_CAP entries', () => {
    let stack = EMPTY_COMMAND_STACK;
    for (let i = 0; i < COMMAND_STACK_CAP + 10; i++) {
      stack = pushCommand(stack, makeDiff(i));
    }
    expect(stack.undoStack).toHaveLength(COMMAND_STACK_CAP);
    // The oldest entries were dropped: the first surviving entry paints value 10, not 0.
    expect(stack.undoStack[0]?.cells[0]?.after).toBe(10);
  });
});
