/**
 * Tool → inspector tab routing for Maker Studio (pure).
 * Keeps the right panel aligned with the tool rail (map rooms/spawn vs paint vs entities).
 */

import type { ToolId } from './tool-sm.js';

export type InspectorTabId = 'map' | 'paint' | 'events' | 'ink' | 'entities';

export const INSPECTOR_TAB_IDS: readonly InspectorTabId[] = [
  'map',
  'paint',
  'events',
  'ink',
  'entities',
] as const;

export interface InspectorRoutingState {
  readonly tab: InspectorTabId;
  readonly manual: boolean;
}

export type InspectorRoutingAction =
  | { readonly type: 'manual-tab'; readonly tab: InspectorTabId }
  | { readonly type: 'explicit-tool'; readonly tool: ToolId }
  | { readonly type: 'tool-state-changed'; readonly tool: ToolId };

export const initialInspectorRoutingState: InspectorRoutingState = {
  tab: 'paint',
  manual: false,
};

/** Keeps manual navigation sticky while allowing user-explicit tool choices to route. */
export function inspectorRoutingReducer(
  state: InspectorRoutingState,
  action: InspectorRoutingAction,
): InspectorRoutingState {
  switch (action.type) {
    case 'manual-tab':
      return { tab: action.tab, manual: true };
    case 'explicit-tool':
      return { tab: inspectorTabForTool(action.tool), manual: false };
    case 'tool-state-changed':
      return state.manual ? state : { tab: inspectorTabForTool(action.tool), manual: false };
  }
}

/** Which inspector tab to open when a tool is selected. */
export function inspectorTabForTool(tool: ToolId): InspectorTabId {
  switch (tool) {
    case 'room-box':
    case 'stair-link':
    case 'spawn-point':
      return 'map';
    case 'prop':
    case 'npc':
    case 'trigger':
    case 'light':
      return 'entities';
    case 'brush':
    case 'box-fill':
    case 'flood-fill':
    case 'eyedropper':
      return 'paint';
    default: {
      const _exhaustive: never = tool;
      return _exhaustive;
    }
  }
}
