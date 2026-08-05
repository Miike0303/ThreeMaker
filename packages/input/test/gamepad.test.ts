import { describe, expect, it } from 'vitest';
import {
  activeActionsFromGamepad,
  createGamepadTracker,
  DEFAULT_GAMEPAD_DEADZONE,
  edgesBetweenActionSets,
  snapshotFromGamepads,
} from '../src/gamepad.js';
import { Actions } from '../src/types.js';

/** Build a snapshot with sparse button presses and optional axes. */
function snap(partial: {
  buttons?: Readonly<Record<number, boolean>>;
  axes?: readonly number[];
}): NonNullable<import('../src/gamepad.js').GamepadSnapshot> {
  const buttons: boolean[] = Array.from({ length: 16 }, () => false);
  for (const [index, pressed] of Object.entries(partial.buttons ?? {})) {
    buttons[Number(index)] = pressed;
  }
  return {
    axes: partial.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

describe('activeActionsFromGamepad', () => {
  it('returns empty for null snapshot (no pad connected)', () => {
    expect(activeActionsFromGamepad(null)).toEqual([]);
  });

  it('maps d-pad (standard buttons 12–15) to a single move.* action', () => {
    expect(activeActionsFromGamepad(snap({ buttons: { 12: true } }))).toEqual([Actions.MoveUp]);
    expect(activeActionsFromGamepad(snap({ buttons: { 13: true } }))).toEqual([Actions.MoveDown]);
    expect(activeActionsFromGamepad(snap({ buttons: { 14: true } }))).toEqual([Actions.MoveLeft]);
    expect(activeActionsFromGamepad(snap({ buttons: { 15: true } }))).toEqual([Actions.MoveRight]);
  });

  it('on d-pad diagonal prefers vertical (up/down before left/right)', () => {
    expect(activeActionsFromGamepad(snap({ buttons: { 12: true, 15: true } }))).toEqual([
      Actions.MoveUp,
    ]);
    expect(activeActionsFromGamepad(snap({ buttons: { 13: true, 14: true } }))).toEqual([
      Actions.MoveDown,
    ]);
  });

  it('maps left stick past deadzone to one cardinal via dominant axis', () => {
    expect(activeActionsFromGamepad(snap({ axes: [0, -0.9, 0, 0] }))).toEqual([Actions.MoveUp]);
    expect(activeActionsFromGamepad(snap({ axes: [0, 0.9, 0, 0] }))).toEqual([Actions.MoveDown]);
    expect(activeActionsFromGamepad(snap({ axes: [-0.9, 0, 0, 0] }))).toEqual([Actions.MoveLeft]);
    expect(activeActionsFromGamepad(snap({ axes: [0.9, 0, 0, 0] }))).toEqual([Actions.MoveRight]);
    // Diagonal: larger |axis| wins
    expect(activeActionsFromGamepad(snap({ axes: [0.8, -0.5, 0, 0] }))).toEqual([
      Actions.MoveRight,
    ]);
    expect(activeActionsFromGamepad(snap({ axes: [0.4, -0.85, 0, 0] }))).toEqual([Actions.MoveUp]);
  });

  it('ignores stick motion inside the deadzone', () => {
    const justUnder = DEFAULT_GAMEPAD_DEADZONE - 0.01;
    expect(activeActionsFromGamepad(snap({ axes: [justUnder, justUnder, 0, 0] }))).toEqual([]);
    expect(activeActionsFromGamepad(snap({ axes: [0.5, 0, 0, 0] }), { deadzone: 0.6 })).toEqual([]);
  });

  it('prefers d-pad over left stick when both are active', () => {
    expect(activeActionsFromGamepad(snap({ buttons: { 14: true }, axes: [0.9, 0, 0, 0] }))).toEqual(
      [Actions.MoveLeft],
    );
  });

  it('maps face button A (0) to interact and LB (4) to view.noclip hold', () => {
    expect(activeActionsFromGamepad(snap({ buttons: { 0: true } }))).toEqual([Actions.Interact]);
    expect(activeActionsFromGamepad(snap({ buttons: { 4: true } }))).toEqual([Actions.ViewNoclip]);
    expect(activeActionsFromGamepad(snap({ buttons: { 0: true, 4: true, 12: true } }))).toEqual([
      Actions.MoveUp,
      Actions.Interact,
      Actions.ViewNoclip,
    ]);
  });
});

describe('edgesBetweenActionSets', () => {
  it('emits pressed for newly active actions', () => {
    expect(edgesBetweenActionSets([], [Actions.Interact, Actions.MoveUp])).toEqual([
      { action: Actions.Interact, edge: 'pressed' },
      { action: Actions.MoveUp, edge: 'pressed' },
    ]);
  });

  it('emits released only for hold actions that leave the active set', () => {
    expect(
      edgesBetweenActionSets([Actions.MoveUp, Actions.Interact, Actions.ViewNoclip], []),
    ).toEqual([
      { action: Actions.MoveUp, edge: 'released' },
      { action: Actions.ViewNoclip, edge: 'released' },
    ]);
  });

  it('emits nothing when the active set is unchanged', () => {
    expect(edgesBetweenActionSets([Actions.MoveLeft], [Actions.MoveLeft])).toEqual([]);
  });
});

describe('createGamepadTracker', () => {
  it('tracks previous sample so only transitions produce edges', () => {
    const tracker = createGamepadTracker();
    const first = tracker.sample(snap({ buttons: { 0: true, 12: true } }));
    expect(first.active).toEqual([Actions.MoveUp, Actions.Interact]);
    expect(first.edges).toEqual([
      { action: Actions.MoveUp, edge: 'pressed' },
      { action: Actions.Interact, edge: 'pressed' },
    ]);

    const held = tracker.sample(snap({ buttons: { 0: true, 12: true } }));
    expect(held.edges).toEqual([]);

    const released = tracker.sample(snap({ buttons: {} }));
    expect(released.active).toEqual([]);
    expect(released.edges).toEqual([{ action: Actions.MoveUp, edge: 'released' }]);
  });

  it('treats disconnect (null) as releasing hold actions', () => {
    const tracker = createGamepadTracker();
    tracker.sample(snap({ buttons: { 12: true, 4: true } }));
    const gone = tracker.sample(null);
    expect(gone.active).toEqual([]);
    expect(gone.edges).toEqual(
      expect.arrayContaining([
        { action: Actions.MoveUp, edge: 'released' },
        { action: Actions.ViewNoclip, edge: 'released' },
      ]),
    );
  });

  it('reset clears previous active so the next sample is a full press', () => {
    const tracker = createGamepadTracker();
    tracker.sample(snap({ buttons: { 12: true } }));
    tracker.reset();
    const again = tracker.sample(snap({ buttons: { 12: true } }));
    expect(again.edges).toEqual([{ action: Actions.MoveUp, edge: 'pressed' }]);
  });
});

describe('snapshotFromGamepads', () => {
  it('picks the first non-null pad and copies axes + pressed flags', () => {
    const snapshot = snapshotFromGamepads([
      null,
      {
        axes: [0.1, -0.2],
        buttons: [{ pressed: false }, { pressed: true }],
      },
    ]);
    expect(snapshot).toEqual({
      axes: [0.1, -0.2],
      buttons: [false, true],
    });
  });

  it('returns null when no pad is present', () => {
    expect(snapshotFromGamepads([])).toBeNull();
    expect(snapshotFromGamepads([null, null])).toBeNull();
  });
});
