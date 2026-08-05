/**
 * Desktop view/debug key mapping over `@threemaker/input` (PLAN_DEV_2 C2).
 *
 * Free of DOM so vitest can drive it. The host still owns applying each
 * action (camera rig, HD2D pipeline, noclip flag).
 *
 * Binding table is injectable (WU-04); defaults keep existing call sites working.
 */

import type { BindingTable } from '@threemaker/input';
import { Actions, defaultBindingTable, resolveKeyboardEdge } from '@threemaker/input';

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
export function resolveViewKeyAction(
  key: string,
  phase: 'down' | 'up',
  table: BindingTable = defaultBindingTable(),
): ViewKeyAction | undefined {
  const edge = resolveKeyboardEdge(key, phase, table);
  if (!edge) return undefined;

  switch (edge.action) {
    case Actions.ViewTogglePostProcessing:
      return edge.edge === 'pressed' ? { kind: 'toggle-post-processing' } : undefined;
    case Actions.ViewCycleCamera:
      return edge.edge === 'pressed' ? { kind: 'cycle-camera-mode' } : undefined;
    case Actions.ViewTiltDown:
      return edge.edge === 'pressed' ? { kind: 'tilt', delta: -1 } : undefined;
    case Actions.ViewTiltUp:
      return edge.edge === 'pressed' ? { kind: 'tilt', delta: 1 } : undefined;
    case Actions.ViewZoomOut:
      return edge.edge === 'pressed' ? { kind: 'zoom', delta: 1 } : undefined;
    case Actions.ViewZoomIn:
      return edge.edge === 'pressed' ? { kind: 'zoom', delta: -1 } : undefined;
    case Actions.ViewNoclip:
      return edge.edge === 'pressed' ? { kind: 'noclip-on' } : { kind: 'noclip-off' };
    default:
      return undefined;
  }
}
