import { describe, expect, it } from 'vitest';
import {
  initialInspectorRoutingState,
  inspectorRoutingReducer,
  inspectorTabForTool,
  INSPECTOR_TAB_IDS,
} from '../src/inspector-routing.js';
import type { ToolId } from '../src/tool-sm.js';

const ALL_TOOLS: readonly ToolId[] = [
  'brush',
  'box-fill',
  'flood-fill',
  'eyedropper',
  'room-box',
  'stair-link',
  'spawn-point',
  'prop',
  'npc',
  'trigger',
  'light',
];

describe('inspectorRoutingReducer', () => {
  it('preserves a manual tab across incidental tool-state changes', () => {
    const manual = inspectorRoutingReducer(initialInspectorRoutingState, {
      type: 'manual-tab',
      tab: 'events',
    });

    expect(
      inspectorRoutingReducer(manual, { type: 'tool-state-changed', tool: 'prop' }),
    ).toEqual({ tab: 'events', manual: true });
  });

  it('replaces a manual tab for an explicit tool selection', () => {
    const manual = { tab: 'ink', manual: true } as const;

    expect(
      inspectorRoutingReducer(manual, { type: 'explicit-tool', tool: 'room-box' }),
    ).toEqual({ tab: 'map', manual: false });
  });

  it('follows incidental tool changes when no manual choice is active', () => {
    expect(
      inspectorRoutingReducer(initialInspectorRoutingState, {
        type: 'tool-state-changed',
        tool: 'light',
      }),
    ).toEqual({ tab: 'entities', manual: false });
  });
});

describe('inspectorTabForTool', () => {
  it('routes paint tools to paint', () => {
    expect(inspectorTabForTool('brush')).toBe('paint');
    expect(inspectorTabForTool('box-fill')).toBe('paint');
    expect(inspectorTabForTool('flood-fill')).toBe('paint');
    expect(inspectorTabForTool('eyedropper')).toBe('paint');
  });

  it('routes map-structure tools to map', () => {
    expect(inspectorTabForTool('room-box')).toBe('map');
    expect(inspectorTabForTool('stair-link')).toBe('map');
    expect(inspectorTabForTool('spawn-point')).toBe('map');
  });

  it('routes entity tools to entities', () => {
    expect(inspectorTabForTool('prop')).toBe('entities');
    expect(inspectorTabForTool('npc')).toBe('entities');
    expect(inspectorTabForTool('trigger')).toBe('entities');
    expect(inspectorTabForTool('light')).toBe('entities');
  });

  it('covers every ToolId with a known inspector tab', () => {
    for (const tool of ALL_TOOLS) {
      expect(INSPECTOR_TAB_IDS).toContain(inspectorTabForTool(tool));
    }
  });
});
