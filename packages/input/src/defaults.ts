import type { ActionBinding } from './types.js';
import { Actions } from './types.js';

/**
 * Default keyboard bindings matching the desktop seams
 * (`walk-input`, `view-input`, `gameplay-input` interact key).
 *
 * Dialogue-only keys (Enter/Space/digits) stay in the host UI layer —
 * they are context-sensitive and not remappable game actions yet.
 */
export function defaultKeyboardBindings(): readonly ActionBinding[] {
  return [
    // Movement (WASD + arrows)
    { action: Actions.MoveUp, source: { device: 'keyboard', key: 'w' } },
    { action: Actions.MoveUp, source: { device: 'keyboard', key: 'ArrowUp' } },
    { action: Actions.MoveDown, source: { device: 'keyboard', key: 's' } },
    { action: Actions.MoveDown, source: { device: 'keyboard', key: 'ArrowDown' } },
    { action: Actions.MoveLeft, source: { device: 'keyboard', key: 'a' } },
    { action: Actions.MoveLeft, source: { device: 'keyboard', key: 'ArrowLeft' } },
    { action: Actions.MoveRight, source: { device: 'keyboard', key: 'd' } },
    { action: Actions.MoveRight, source: { device: 'keyboard', key: 'ArrowRight' } },

    // Gameplay interact (idle only — host still gates by interpreter state)
    { action: Actions.Interact, source: { device: 'keyboard', key: 'e' } },

    // View / debug
    { action: Actions.ViewTogglePostProcessing, source: { device: 'keyboard', key: 'p' } },
    { action: Actions.ViewCycleCamera, source: { device: 'keyboard', key: 'c' } },
    { action: Actions.ViewTiltDown, source: { device: 'keyboard', key: '[' } },
    { action: Actions.ViewTiltUp, source: { device: 'keyboard', key: ']' } },
    { action: Actions.ViewZoomOut, source: { device: 'keyboard', key: '-' } },
    { action: Actions.ViewZoomOut, source: { device: 'keyboard', key: '_' } },
    { action: Actions.ViewZoomIn, source: { device: 'keyboard', key: '=' } },
    { action: Actions.ViewZoomIn, source: { device: 'keyboard', key: '+' } },
    { action: Actions.ViewNoclip, source: { device: 'keyboard', key: 'Control' } },

    // System save/load (C3) — F5/F9: common quick-save / quick-load, unused elsewhere
    { action: Actions.SystemSave, source: { device: 'keyboard', key: 'F5' } },
    { action: Actions.SystemLoad, source: { device: 'keyboard', key: 'F9' } },
  ];
}
