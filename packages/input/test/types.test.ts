import { describe, expect, it } from 'vitest';
import { bindingTableFromPersistedText } from '../src/bindings-document.js';
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

it('resolves the persisted move-down identifier to downward movement', () => {
  expect(directionFromMoveAction('move.down')).toBe('down');
});

it('resolves the persisted move-left identifier to leftward movement', () => {
  expect(directionFromMoveAction('move.left')).toBe('left');
});

it('resolves the persisted move-right identifier to rightward movement', () => {
  expect(directionFromMoveAction('move.right')).toBe('right');
});

it('recognizes the persisted noclip identifier as a hold action', () => {
  expect(HOLD_ACTIONS.has('view.noclip')).toBe(true);
});

it('resolves the persisted move-up identifier to upward movement', () => {
  expect(directionFromMoveAction('move.up')).toBe('up');
});

function loadPersistedActionOverride(action: string) {
  return bindingTableFromPersistedText(
    JSON.stringify({
      magic: 'threemaker.input-bindings',
      version: 1,
      bindings: [{ action, source: { device: 'keyboard', key: 'q' } }],
    }),
  );
}

it('loads a persisted quick-save override for the current save action', () => {
  const table = loadPersistedActionOverride('system.save');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.SystemSave);
  expect(table.actionForKeyboardKey('F5')).toBeUndefined();
});

it('loads a persisted quick-load override for the current load action', () => {
  const table = loadPersistedActionOverride('system.load');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.SystemLoad);
  expect(table.actionForKeyboardKey('F9')).toBeUndefined();
});

it('loads a persisted camera-cycle override for the current camera action', () => {
  const table = loadPersistedActionOverride('view.cycleCamera');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.ViewCycleCamera);
  expect(table.actionForKeyboardKey('c')).toBeUndefined();
});

it('loads a persisted post-processing override for the current toggle action', () => {
  const table = loadPersistedActionOverride('view.togglePostProcessing');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.ViewTogglePostProcessing);
  expect(table.actionForKeyboardKey('p')).toBeUndefined();
});

it('loads a persisted downward-tilt override for the current tilt action', () => {
  const table = loadPersistedActionOverride('view.tiltDown');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.ViewTiltDown);
  expect(table.actionForKeyboardKey('[')).toBeUndefined();
});

it('loads a persisted upward-tilt override for the current tilt action', () => {
  const table = loadPersistedActionOverride('view.tiltUp');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.ViewTiltUp);
  expect(table.actionForKeyboardKey(']')).toBeUndefined();
});

it('loads a persisted zoom-out override and replaces both default aliases', () => {
  const table = loadPersistedActionOverride('view.zoomOut');

  expect(table.actionForKeyboardKey('q')).toBe(Actions.ViewZoomOut);
  expect(table.actionForKeyboardKey('-')).toBeUndefined();
  expect(table.actionForKeyboardKey('_')).toBeUndefined();
});
