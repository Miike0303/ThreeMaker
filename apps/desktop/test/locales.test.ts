/**
 * Locale key parity (loop-crear-jugar Slice 4b): `map.noAuthoredMap` is the
 * PROD-gating message shown when no authored map file exists and there is no
 * DEV fixture fallback available (`main.ts`'s `!import.meta.env.DEV`
 * branch). Both locales must define it with real, non-empty text -- a
 * missing key would silently fall back to rendering the raw key string to
 * the user (`i18n.ts`'s `t()` fallback chain).
 */
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json' with { type: 'json' };
import es from '../src/locales/es.json' with { type: 'json' };

describe('locale strings', () => {
  it('defines map.noAuthoredMap with real text in both en and es', () => {
    expect(en.strings['map.noAuthoredMap']).toBeTruthy();
    expect(es.strings['map.noAuthoredMap']).toBeTruthy();
    expect(en.strings['map.noAuthoredMap']).not.toBe('map.noAuthoredMap');
    expect(es.strings['map.noAuthoredMap']).not.toBe('map.noAuthoredMap');
  });

  it('keeps en and es in sync: identical key sets', () => {
    expect(Object.keys(es.strings).sort()).toEqual(Object.keys(en.strings).sort());
  });
});
