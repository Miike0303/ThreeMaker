import { describe, expect, it } from 'vitest';
import { inspectorTabForTool, INSPECTOR_TAB_IDS } from '../src/inspector-routing.js';
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
