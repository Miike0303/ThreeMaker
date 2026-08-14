import { describe, expect, it } from 'vitest';
import {
  beginStroke,
  continueStroke,
  endStroke,
  isPostProcessingShortcut,
  resolveEditorChord,
  resolveToolShortcut,
  shouldIgnoreToolShortcut,
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
    expect(resolveToolShortcut('h')).toBeUndefined();
  });
});

describe('isPostProcessingShortcut', () => {
  it('matches H case-insensitively', () => {
    expect(isPostProcessingShortcut('h')).toBe(true);
    expect(isPostProcessingShortcut('H')).toBe(true);
  });

  it('rejects tool keys and unrelated keys', () => {
    expect(isPostProcessingShortcut('b')).toBe(false);
    expect(isPostProcessingShortcut('p')).toBe(false);
    expect(isPostProcessingShortcut('Enter')).toBe(false);
  });
});

describe('shouldIgnoreToolShortcut (WU-UX-02 keyboard guard)', () => {
  const noModifiers = {};

  it('ignores shortcuts while focus is in an input, textarea, or select', () => {
    expect(shouldIgnoreToolShortcut({ tagName: 'INPUT' }, noModifiers)).toBe(true);
    expect(shouldIgnoreToolShortcut({ tagName: 'TEXTAREA' }, noModifiers)).toBe(true);
    expect(shouldIgnoreToolShortcut({ tagName: 'SELECT' }, noModifiers)).toBe(true);
  });

  it('matches tag names case-insensitively', () => {
    expect(shouldIgnoreToolShortcut({ tagName: 'input' }, noModifiers)).toBe(true);
  });

  it('ignores shortcuts while focus is in a contentEditable element', () => {
    expect(shouldIgnoreToolShortcut({ tagName: 'DIV', isContentEditable: true }, noModifiers)).toBe(
      true,
    );
  });

  it('ignores shortcuts while ctrl, meta, or alt is held', () => {
    expect(shouldIgnoreToolShortcut({ tagName: 'CANVAS' }, { ctrlKey: true })).toBe(true);
    expect(shouldIgnoreToolShortcut({ tagName: 'CANVAS' }, { metaKey: true })).toBe(true);
    expect(shouldIgnoreToolShortcut({ tagName: 'CANVAS' }, { altKey: true })).toBe(true);
  });

  it('allows shortcuts from non-editable targets with no modifiers held', () => {
    expect(shouldIgnoreToolShortcut({ tagName: 'CANVAS' }, noModifiers)).toBe(false);
    expect(shouldIgnoreToolShortcut({ tagName: 'BODY' }, noModifiers)).toBe(false);
    expect(shouldIgnoreToolShortcut(null, noModifiers)).toBe(false);
    expect(
      shouldIgnoreToolShortcut({ tagName: 'DIV', isContentEditable: false }, noModifiers),
    ).toBe(false);
  });
});

describe('resolveEditorChord (WU-UX-03 editor chords)', () => {
  it('resolves Ctrl/Cmd+Z to undo', () => {
    expect(resolveEditorChord({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(resolveEditorChord({ key: 'Z', metaKey: true })).toBe('undo');
  });

  it('resolves Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z to redo', () => {
    expect(resolveEditorChord({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(resolveEditorChord({ key: 'Y', metaKey: true })).toBe('redo');
    expect(resolveEditorChord({ key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(resolveEditorChord({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
  });

  it('resolves Ctrl/Cmd+S to save', () => {
    expect(resolveEditorChord({ key: 's', ctrlKey: true })).toBe('save');
    expect(resolveEditorChord({ key: 'S', metaKey: true })).toBe('save');
  });

  it('resolves Escape to cancel with no modifier required', () => {
    expect(resolveEditorChord({ key: 'Escape' })).toBe('cancel');
  });

  it('returns null for bare keys and non-chord combinations', () => {
    expect(resolveEditorChord({ key: 'z' })).toBeNull();
    expect(resolveEditorChord({ key: 's' })).toBeNull();
    expect(resolveEditorChord({ key: 'b', ctrlKey: true })).toBeNull();
    expect(resolveEditorChord({ key: 'z', shiftKey: true })).toBeNull();
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

describe('ToolSM: prop tool (C5 WU-04 -- depth-props-hd)', () => {
  it('resolves "O" (case-insensitive) to prop', () => {
    expect(resolveToolShortcut('o')).toBe('prop');
    expect(resolveToolShortcut('O')).toBe('prop');
  });

  it('the generic stroking transitions still work structurally for prop (never actually driven this way -- painter-store.ts short-circuits prop in pointerDown, same as spawn-point)', () => {
    const propStroking = beginStroke(TOOL_SM_IDLE, 'prop', 0, { x: 1, y: 2 });
    expect(propStroking).toMatchObject({ status: 'stroking', tool: 'prop' });
    expect(endStroke(propStroking)).toEqual({ status: 'idle' });
  });
});

describe('ToolSM: npc + trigger tools (c1a follow-up)', () => {
  it('resolves "N"/"T" (case-insensitive) to npc/trigger', () => {
    expect(resolveToolShortcut('n')).toBe('npc');
    expect(resolveToolShortcut('N')).toBe('npc');
    expect(resolveToolShortcut('t')).toBe('trigger');
    expect(resolveToolShortcut('T')).toBe('trigger');
  });

  it('the generic stroking transitions still work structurally for npc/trigger (never actually driven this way -- painter-store.ts short-circuits them in pointerDown, same as prop)', () => {
    const npcStroking = beginStroke(TOOL_SM_IDLE, 'npc', 0, { x: 1, y: 2 });
    expect(npcStroking).toMatchObject({ status: 'stroking', tool: 'npc' });
    expect(endStroke(npcStroking)).toEqual({ status: 'idle' });

    const triggerStroking = beginStroke(TOOL_SM_IDLE, 'trigger', 0, { x: 2, y: 3 });
    expect(triggerStroking).toMatchObject({ status: 'stroking', tool: 'trigger' });
    expect(endStroke(triggerStroking)).toEqual({ status: 'idle' });
  });
});
