import type { ActionEdge } from './keyboard.js';
import type { ActionId } from './types.js';
import { Actions, HOLD_ACTIONS } from './types.js';

/**
 * Pure snapshot of one gamepad, free of `navigator` / DOM so vitest can drive
 * it. Shape mirrors the fields of the W3C Gamepad API that we actually use.
 */
export type GamepadSnapshot = {
  readonly axes: readonly number[];
  /** Index → pressed (same order as `Gamepad.buttons`). */
  readonly buttons: readonly boolean[];
} | null;

/** Minimal pad shape accepted by {@link snapshotFromGamepads}. */
export type GamepadLike = {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
};

/**
 * Stick / trigger digital threshold. Below this, axes are treated as neutral
 * so idle drift does not walk the character.
 */
export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

/** Standard Gamepad mapping indices (W3C "standard" mapping). */
export const StandardGamepadButton = {
  /** Bottom face button (A / Cross) — confirm / interact. */
  A: 0,
  /** Left bumper (L1 / LB) — hold noclip (debug, same family as Ctrl). */
  Lb: 4,
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
} as const;

export const StandardGamepadAxis = {
  LeftX: 0,
  /** Standard mapping: negative Y is up. */
  LeftY: 1,
} as const;

export type GamepadSampleOptions = {
  readonly deadzone?: number;
};

/**
 * Pick the first connected pad from a `getGamepads()`-like list and copy the
 * fields the pure sampler needs. Returns null when nothing is connected.
 */
export function snapshotFromGamepads(
  pads: ReadonlyArray<GamepadLike | null | undefined>,
): GamepadSnapshot {
  for (const pad of pads) {
    if (!pad) continue;
    return {
      axes: pad.axes,
      buttons: pad.buttons.map((b) => b.pressed),
    };
  }
  return null;
}

function buttonPressed(buttons: readonly boolean[], index: number): boolean {
  return buttons[index] === true;
}

/**
 * D-pad → at most one move action. Vertical wins over horizontal so a
 * diagonal press still yields a legal grid direction.
 */
function moveFromDpad(buttons: readonly boolean[]): ActionId | undefined {
  if (buttonPressed(buttons, StandardGamepadButton.DpadUp)) return Actions.MoveUp;
  if (buttonPressed(buttons, StandardGamepadButton.DpadDown)) return Actions.MoveDown;
  if (buttonPressed(buttons, StandardGamepadButton.DpadLeft)) return Actions.MoveLeft;
  if (buttonPressed(buttons, StandardGamepadButton.DpadRight)) return Actions.MoveRight;
  return undefined;
}

/**
 * Left stick → one cardinal when outside the deadzone. Dominant axis wins on
 * diagonals so the grid mover never receives two simultaneous directions.
 */
function moveFromLeftStick(axes: readonly number[], deadzone: number): ActionId | undefined {
  const x = axes[StandardGamepadAxis.LeftX] ?? 0;
  const y = axes[StandardGamepadAxis.LeftY] ?? 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < deadzone && ay < deadzone) return undefined;
  if (ax >= ay) {
    return x < 0 ? Actions.MoveLeft : Actions.MoveRight;
  }
  return y < 0 ? Actions.MoveUp : Actions.MoveDown;
}

/**
 * Currently held logical actions for one gamepad snapshot.
 *
 * Mapping (standard layout):
 * - D-pad / left stick → one of `move.*` (d-pad preferred over stick)
 * - A (button 0) → `interact`
 * - LB (button 4) → `view.noclip` (hold; the only view *hold* action)
 *
 * One-shot view toggles (post-process, camera mode, tilt/zoom steps) stay
 * keyboard-only for now — they are debug chrome, not core play controls.
 */
export function activeActionsFromGamepad(
  snapshot: GamepadSnapshot,
  options?: GamepadSampleOptions,
): readonly ActionId[] {
  if (snapshot === null) return [];

  const deadzone = options?.deadzone ?? DEFAULT_GAMEPAD_DEADZONE;
  const active: ActionId[] = [];

  const move = moveFromDpad(snapshot.buttons) ?? moveFromLeftStick(snapshot.axes, deadzone);
  if (move !== undefined) active.push(move);

  if (buttonPressed(snapshot.buttons, StandardGamepadButton.A)) {
    active.push(Actions.Interact);
  }
  if (buttonPressed(snapshot.buttons, StandardGamepadButton.Lb)) {
    active.push(Actions.ViewNoclip);
  }

  return active;
}

/**
 * Diff two active-action sets into pressed/released edges.
 * One-shot actions only emit `pressed` (matches keyboard adapter).
 */
export function edgesBetweenActionSets(
  previous: readonly ActionId[],
  current: readonly ActionId[],
  holdActions: ReadonlySet<ActionId> = HOLD_ACTIONS,
): readonly ActionEdge[] {
  const prev = new Set(previous);
  const next = new Set(current);
  const edges: ActionEdge[] = [];

  for (const action of current) {
    if (!prev.has(action)) {
      edges.push({ action, edge: 'pressed' });
    }
  }
  for (const action of previous) {
    if (!next.has(action) && holdActions.has(action)) {
      edges.push({ action, edge: 'released' });
    }
  }
  return edges;
}

export type GamepadSample = {
  readonly active: readonly ActionId[];
  readonly edges: readonly ActionEdge[];
};

export type GamepadTracker = {
  /** Sample the next frame; remembers active set for edge detection. */
  sample(snapshot: GamepadSnapshot): GamepadSample;
  /** Drop remembered state (e.g. after a host reset). */
  reset(): void;
};

/** Stateful helper: previous active set + pure snapshot → active + edges. */
export function createGamepadTracker(options?: GamepadSampleOptions): GamepadTracker {
  let previous: readonly ActionId[] = [];

  return {
    sample(snapshot) {
      const active = activeActionsFromGamepad(snapshot, options);
      const edges = edgesBetweenActionSets(previous, active);
      previous = active;
      return { active, edges };
    },
    reset() {
      previous = [];
    },
  };
}
