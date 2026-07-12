import { describe, expect, it } from 'vitest';
import {
  beginStroke,
  continueStroke,
  endStroke,
  resolveToolShortcut,
  TOOL_SM_IDLE,
} from '../src/tool-sm.js';

describe('resolveToolShortcut', () => {
  it('resolves B/U/G/I (case-insensitive) to brush/box-fill/flood-fill/eyedropper', () => {
    expect(resolveToolShortcut('b')).toBe('brush');
    expect(resolveToolShortcut('B')).toBe('brush');
    expect(resolveToolShortcut('u')).toBe('box-fill');
    expect(resolveToolShortcut('U')).toBe('box-fill');
    expect(resolveToolShortcut('g')).toBe('flood-fill');
    expect(resolveToolShortcut('G')).toBe('flood-fill');
    expect(resolveToolShortcut('i')).toBe('eyedropper');
    expect(resolveToolShortcut('I')).toBe('eyedropper');
  });

  it('returns undefined for a non-shortcut key', () => {
    expect(resolveToolShortcut('x')).toBeUndefined();
    expect(resolveToolShortcut('Enter')).toBeUndefined();
  });
});

describe('ToolSM idle -> stroking -> idle', () => {
  it('starts idle', () => {
    expect(TOOL_SM_IDLE).toEqual({ status: 'idle' });
  });

  it('pointerdown (beginStroke) transitions idle -> stroking, capturing tool/layer/start point', () => {
    const stroking = beginStroke(TOOL_SM_IDLE, 'brush', 0, { x: 3, y: 4 });
    expect(stroking).toEqual({
      status: 'stroking',
      tool: 'brush',
      layer: 0,
      startX: 3,
      startY: 4,
      points: [{ x: 3, y: 4 }],
    });
  });

  it('a second pointerdown while already stroking is ignored (state unchanged)', () => {
    const stroking = beginStroke(TOOL_SM_IDLE, 'brush', 0, { x: 0, y: 0 });
    const second = beginStroke(stroking, 'flood-fill', 2, { x: 9, y: 9 });
    expect(second).toBe(stroking);
  });

  it('pointermove (continueStroke) appends points while stroking', () => {
    let state = beginStroke(TOOL_SM_IDLE, 'brush', 0, { x: 0, y: 0 });
    state = continueStroke(state, { x: 1, y: 0 });
    state = continueStroke(state, { x: 2, y: 0 });

    expect(state).toEqual({
      status: 'stroking',
      tool: 'brush',
      layer: 0,
      startX: 0,
      startY: 0,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    });
  });

  it('continueStroke dedupes an exact repeat of the last point', () => {
    let state = beginStroke(TOOL_SM_IDLE, 'brush', 0, { x: 0, y: 0 });
    state = continueStroke(state, { x: 0, y: 0 });
    expect(state).toMatchObject({ points: [{ x: 0, y: 0 }] });
  });

  it('continueStroke is a no-op while idle', () => {
    expect(continueStroke(TOOL_SM_IDLE, { x: 1, y: 1 })).toBe(TOOL_SM_IDLE);
  });

  it('pointerup (endStroke) transitions stroking -> idle', () => {
    const stroking = beginStroke(TOOL_SM_IDLE, 'box-fill', 1, { x: 0, y: 0 });
    expect(endStroke(stroking)).toEqual({ status: 'idle' });
  });

  it('endStroke is a safe no-op while already idle', () => {
    expect(endStroke(TOOL_SM_IDLE)).toEqual({ status: 'idle' });
  });
});

describe('ToolSM: room-box tool (Slice 5b -- techos-y-oclusion-interiores)', () => {
  it('resolves "R" (case-insensitive) to the room-box tool', () => {
    expect(resolveToolShortcut('r')).toBe('room-box');
    expect(resolveToolShortcut('R')).toBe('room-box');
  });

  it('drags a room-box stroke idle -> stroking -> idle exactly like box-fill', () => {
    let state = beginStroke(TOOL_SM_IDLE, 'room-box', 0, { x: 2, y: 3 });
    expect(state).toEqual({
      status: 'stroking',
      tool: 'room-box',
      layer: 0,
      startX: 2,
      startY: 3,
      points: [{ x: 2, y: 3 }],
    });

    state = continueStroke(state, { x: 5, y: 6 });
    expect(state).toMatchObject({
      points: [
        { x: 2, y: 3 },
        { x: 5, y: 6 },
      ],
    });

    expect(endStroke(state)).toEqual({ status: 'idle' });
  });
});

describe('ToolSM: stair-link + spawn-point tools (Slice 5b -- loop-crear-jugar)', () => {
  it('resolves "S"/"P" (case-insensitive) to stair-link/spawn-point', () => {
    expect(resolveToolShortcut('s')).toBe('stair-link');
    expect(resolveToolShortcut('S')).toBe('stair-link');
    expect(resolveToolShortcut('p')).toBe('spawn-point');
    expect(resolveToolShortcut('P')).toBe('spawn-point');
  });

  it('the generic stroking transitions still work structurally for both tool ids (never actually driven this way -- painter-store.ts short-circuits them in pointerDown, same as eyedropper -- but ToolSM itself stays generic over every ToolId)', () => {
    const stairStroking = beginStroke(TOOL_SM_IDLE, 'stair-link', 0, { x: 1, y: 1 });
    expect(stairStroking).toEqual({
      status: 'stroking',
      tool: 'stair-link',
      layer: 0,
      startX: 1,
      startY: 1,
      points: [{ x: 1, y: 1 }],
    });
    expect(endStroke(stairStroking)).toEqual({ status: 'idle' });

    const spawnStroking = beginStroke(TOOL_SM_IDLE, 'spawn-point', 0, { x: 2, y: 2 });
    expect(spawnStroking).toMatchObject({ status: 'stroking', tool: 'spawn-point' });
    expect(endStroke(spawnStroking)).toEqual({ status: 'idle' });
  });
});
