/**
 * Status-bar context line helpers (WU-UX-11). Pure.
 *
 * DESIGN.md: "Named layers and floors always visible when map ready" —
 * the status bar shows the active tool, the NAMED paint layer
 * (Ground/Mid/Wall/Over), and the floor label, never raw `L0 · F0`
 * indices (recognition over recall).
 */

import type { ToolId } from './tool-sm.js';

/** Paint-layer display-name keys in schema order (0–3). */
export const STATUS_LAYER_NAME_KEYS = [
  'painter.layer.ground',
  'painter.layer.mid',
  'painter.layer.wall',
  'painter.layer.over',
] as const;

/**
 * Tool label key for the status bar. Brush with fill tile 0 is the eraser —
 * the same rule the tool rail uses for its active state, so the readout
 * never says "Brush" while erasing.
 */
export function statusToolKey(tool: ToolId, fillTileId: number): string {
  return tool === 'brush' && fillTileId === 0 ? 'painter.tool.eraser' : `painter.tool.${tool}`;
}

/** Layer display-name key; out-of-range indices fall back to Ground. */
export function statusLayerNameKey(layer: number): string {
  return STATUS_LAYER_NAME_KEYS[layer] ?? STATUS_LAYER_NAME_KEYS[0];
}
