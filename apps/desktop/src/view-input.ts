/**
 * Pure view/debug key mapping extracted from `main.ts` (PLAN_DEV_2 C2 prep:
 * extract existing desktop input before a shared `packages/input` layer).
 *
 * Free of DOM so vitest can drive it. The host still owns applying each
 * action (camera rig, HD2D pipeline, noclip flag).
 */

export type ViewKeyAction =
  | { readonly kind: 'toggle-post-processing' }
  | { readonly kind: 'cycle-camera-mode' }
  /** Negative = look down (less tilt), positive = look up (more tilt). */
  | { readonly kind: 'tilt'; readonly delta: -1 | 1 }
  /**
   * Positive = boom farther (zoom out / `-` key), negative = boom closer
   * (zoom in / `=` key). Magnitude is one step; the host scales by knobs.
   */
  | { readonly kind: 'zoom'; readonly delta: -1 | 1 }
  | { readonly kind: 'noclip-on' }
  | { readonly kind: 'noclip-off' };

/**
 * Resolve a raw `KeyboardEvent.key` into a view/debug action.
 *
 * @param phase - `down` for keydown, `up` for keyup (only Ctrl uses `up`)
 * @returns undefined when the key is not mapped in this phase
 */
export function resolveViewKeyAction(key: string, phase: 'down' | 'up'): ViewKeyAction | undefined {
  const normalized = key.toLowerCase();

  if (phase === 'up') {
    return normalized === 'control' ? { kind: 'noclip-off' } : undefined;
  }

  switch (normalized) {
    case 'p':
      return { kind: 'toggle-post-processing' };
    case 'c':
      return { kind: 'cycle-camera-mode' };
    case '[':
      return { kind: 'tilt', delta: -1 };
    case ']':
      return { kind: 'tilt', delta: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', delta: 1 };
    case '=':
    case '+':
      return { kind: 'zoom', delta: -1 };
    case 'control':
      return { kind: 'noclip-on' };
    default:
      return undefined;
  }
}
