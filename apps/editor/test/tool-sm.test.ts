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
