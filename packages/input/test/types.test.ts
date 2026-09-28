import { describe, expect, it } from 'vitest';
import { Actions, directionFromMoveAction, HOLD_ACTIONS, isMoveAction } from '../src/types.js';

describe('isMoveAction', () => {
  it('rejects inherited object property names as move actions', () => {
    expect(isMoveAction('toString')).toBe(false);
  });

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

it('keeps move down active until key release', () => {
  expect(HOLD_ACTIONS.has(Actions.MoveDown)).toBe(true);
});

it('keeps quick save distinct from quick load', () => {
  expect(Actions.SystemSave).not.toBe(Actions.SystemLoad);
});

describe('directionFromMoveAction', () => {
  it('maps the left action to the left grid direction', () => {
    expect(directionFromMoveAction(Actions.MoveLeft)).toBe('left');
  });

  it('maps the right action to the right grid direction', () => {
    expect(directionFromMoveAction(Actions.MoveRight)).toBe('right');
  });

  it('maps the down action to the down grid direction', () => {
    expect(directionFromMoveAction(Actions.MoveDown)).toBe('down');
  });

  it('maps move actions to grid directions and rejects non-move', () => {
    expect(directionFromMoveAction(Actions.MoveUp)).toBe('up');
    expect(directionFromMoveAction(Actions.Interact)).toBeUndefined();
    expect(directionFromMoveAction(undefined)).toBeUndefined();
  });
});

it('keeps move left active until key release', () => {
  expect(HOLD_ACTIONS.has(Actions.MoveLeft)).toBe(true);
});

it('keeps move right active until key release', () => {
  expect(HOLD_ACTIONS.has(Actions.MoveRight)).toBe(true);
});

it('keeps quick save and quick load as one-shot actions', () => {
  expect(HOLD_ACTIONS.has(Actions.SystemSave)).toBe(false);
  expect(HOLD_ACTIONS.has(Actions.SystemLoad)).toBe(false);
});
