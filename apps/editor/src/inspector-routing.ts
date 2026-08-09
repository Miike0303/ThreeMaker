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
