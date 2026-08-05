import { describe, expect, it } from 'vitest';
import { Actions, directionFromMoveAction, isMoveAction } from '../src/types.js';

describe('isMoveAction', () => {
  it('is true only for the four move.* actions', () => {
    expect(isMoveAction(Actions.MoveUp)).toBe(true);
    expect(isMoveAction(Actions.MoveDown)).toBe(true);
    expect(isMoveAction(Actions.MoveLeft)).toBe(true);
    expect(isMoveAction(Actions.MoveRight)).toBe(true);
    expect(isMoveAction(Actions.Interact)).toBe(false);
    expect(isMoveAction(Actions.ViewNoclip)).toBe(false);
    expect(isMoveAction('move.diagonal')).toBe(false);
    expect(isMoveAction('other')).toBe(false);
  });
});

describe('directionFromMoveAction', () => {
  it('maps move actions to grid directions and rejects non-move', () => {
    expect(directionFromMoveAction(Actions.MoveUp)).toBe('up');
    expect(directionFromMoveAction(Actions.Interact)).toBeUndefined();
    expect(directionFromMoveAction(undefined)).toBeUndefined();
  });
});
