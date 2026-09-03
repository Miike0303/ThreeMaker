/**
 * Pins camera-only overlay recomputes to reuse ramp glyph *cells* instead of
 * re-running computeRampGlyphCells (deriveRampCells W×H×layers) on every pan.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const VIEWPORT_SOURCE = readFileSync(join(SRC, 'painter-viewport.ts'), 'utf8');

describe('PainterViewport ramp glyph camera cache source pin', () => {
  it('recomputeRampGlyphs caches cells and live paint clears the cache', () => {
    expect(VIEWPORT_SOURCE).toMatch(/rampGlyphCellsCache/);
    expect(VIEWPORT_SOURCE).toMatch(/needsCellRefresh/);
    expect(VIEWPORT_SOURCE).toMatch(/needsCellRefresh\s*\?\s*computeRampGlyphCells\(/);
    expect(VIEWPORT_SOURCE).toMatch(/:\s*\(this\.rampGlyphCellsCache\s*\?\?\s*\[\]\)/);
    expect(VIEWPORT_SOURCE).toMatch(/this\.rampGlyphCellsCache = undefined/);
    // Camera pan still goes through recomputeOverlays → recomputeRampGlyphs,
    // but must not force a cell refresh on every call.
    expect(VIEWPORT_SOURCE).not.toMatch(/recomputeRampGlyphs\(\{\s*force/);
  });
});
