import { describe, expect, it } from 'vitest';
import {
  STATUS_LAYER_NAME_KEYS,
  statusLayerNameKey,
  statusToolKey,
} from '../src/painter-status.js';

describe('statusToolKey (WU-UX-11)', () => {
  it('maps every tool to its painter.tool.* key', () => {
    expect(statusToolKey('brush', 7)).toBe('painter.tool.brush');
    expect(statusToolKey('flood-fill', 7)).toBe('painter.tool.flood-fill');
    expect(statusToolKey('light', 7)).toBe('painter.tool.light');
  });

  it('shows the eraser when the brush paints tile 0 (tool-rail rule)', () => {
    expect(statusToolKey('brush', 0)).toBe('painter.tool.eraser');
  });
});

describe('statusLayerNameKey (WU-UX-11)', () => {
  it('names the four paint layers in schema order', () => {
    expect(STATUS_LAYER_NAME_KEYS.map((_, i) => statusLayerNameKey(i))).toEqual([
      'painter.layer.ground',
      'painter.layer.mid',
      'painter.layer.wall',
      'painter.layer.over',
    ]);
  });

  it('falls back to Ground for an out-of-range index', () => {
    expect(statusLayerNameKey(9)).toBe('painter.layer.ground');
  });
});
