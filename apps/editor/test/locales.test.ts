/**
 * Locale key parity (loop-crear-jugar Slice 5b): the stair-link/spawn-point
 * authoring UI's new keys must exist with real, non-empty text in BOTH
 * locales -- a missing key would silently fall back to rendering the raw
 * key string to the user (`i18n.ts`'s `t()` fallback chain). Mirrors
 * apps/desktop/test/locales.test.ts's pattern (same shared `i18n.ts`).
 */
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json' with { type: 'json' };
import es from '../src/locales/es.json' with { type: 'json' };

const NEW_KEYS = [
  'painter.tool.stair-link',
  'painter.tool.spawn-point',
  'painter.stairLinks',
  'painter.stairLink.summary',
  'painter.stairLink.bidirectional',
  'painter.stairLink.remove',
  'painter.stairLink.entryLabel',
  'painter.stairLink.exitLabel',
  'painter.stairLink.pendingHint',
  'painter.spawn',
  'painter.spawn.notSet',
  'painter.spawn.summary',
  'painter.spawn.clear',
  'painter.spawn.overlayLabel',
] as const;

describe('locale strings: stair-link + spawn-point authoring (Slice 5b)', () => {
  it.each(NEW_KEYS)('defines %s with real text in both en and es', (key) => {
    expect((en.strings as Record<string, string>)[key]).toBeTruthy();
    expect((es.strings as Record<string, string>)[key]).toBeTruthy();
    expect((en.strings as Record<string, string>)[key]).not.toBe(key);
    expect((es.strings as Record<string, string>)[key]).not.toBe(key);
  });

  it('keeps en and es in sync: identical key sets', () => {
    expect(Object.keys(es.strings).sort()).toEqual(Object.keys(en.strings).sort());
  });
});
