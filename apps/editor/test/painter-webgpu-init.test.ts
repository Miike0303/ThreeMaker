/**
 * Pins WebGPU init failure to the status toast path (not console-only).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORT_SOURCE = readFileSync(join(ROOT, 'src/painter-viewport.ts'), 'utf8');
const PANEL_SOURCE = readFileSync(join(ROOT, 'src/components/PainterPanel.tsx'), 'utf8');

describe('Painter WebGPU init error source pin', () => {
  it('rejects init through onInitError and PainterPanel toasts painter.webgpu.failed', () => {
    expect(VIEWPORT_SOURCE).toContain('this.callbacks.onInitError?.(error)');
    expect(PANEL_SOURCE).toContain('onInitError:');
    expect(PANEL_SOURCE).toContain("tRef.current('painter.webgpu.failed')");
  });
});
