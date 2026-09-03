/**
 * Pins the live-paint ramp path: ordinary strokes must sync dirty cells,
 * not re-derive W×H×layers on every applyDiffLiveUpdate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const VIEWPORT_SOURCE = readFileSync(join(SRC, 'painter-viewport.ts'), 'utf8');

describe('PainterViewport incremental ramp sync source pin', () => {
  it('resolveRampCells uses syncRampCells for dirty strokes and full derive on force', () => {
    expect(VIEWPORT_SOURCE).toMatch(/syncRampCells\(/);
    expect(VIEWPORT_SOURCE).toMatch(/deriveRampCells\(/);
    expect(VIEWPORT_SOURCE).toMatch(/resolveRampCells\(\{\s*dirtyCells:\s*diff\.cells\s*\}\)/);
    expect(VIEWPORT_SOURCE).toMatch(/resolveRampCells\(\{\s*forceFull:\s*true\s*\}\)/);
    expect(VIEWPORT_SOURCE).toMatch(/rampCacheSemantics\s*!==\s*semantics/);
  });
});
