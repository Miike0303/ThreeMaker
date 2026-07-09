import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n.js';

const LOCALES = {
  en: { name: 'English', strings: { greeting: 'Hello', onlyInEnglish: 'English only' } },
  es: { name: 'Español', strings: { greeting: 'Hola' } },
};

describe('createI18n', () => {
  it('defaults to the given initial locale', () => {
    const i18n = createI18n(LOCALES, 'es');
    expect(i18n.locale).toBe('es');
    expect(i18n.t('greeting')).toBe('Hola');
  });

  it('defaults to "en" when no initial locale is given', () => {
    const i18n = createI18n(LOCALES);
    expect(i18n.locale).toBe('en');
  });

  it('falls back to "en" for a key missing in the current (non-en) locale', () => {
    const i18n = createI18n(LOCALES, 'es');
    expect(i18n.t('onlyInEnglish')).toBe('English only');
  });

  it('falls back to the key itself when the key is missing everywhere', () => {
    const i18n = createI18n(LOCALES, 'es');
    expect(i18n.t('doesNotExist')).toBe('doesNotExist');
  });

  it('setLocale switches the active locale and t() reflects the change', () => {
    const i18n = createI18n(LOCALES, 'en');
    i18n.setLocale('es');
    expect(i18n.locale).toBe('es');
    expect(i18n.t('greeting')).toBe('Hola');
  });

  it('setLocale to an unknown code is a no-op (keeps the current locale)', () => {
    const i18n = createI18n(LOCALES, 'en');
    i18n.setLocale('fr');
    expect(i18n.locale).toBe('en');
    expect(i18n.t('greeting')).toBe('Hello');
  });

  it('creating with an unknown initial locale falls back to "en"', () => {
    const i18n = createI18n(LOCALES, 'fr');
    expect(i18n.locale).toBe('en');
  });

  it('exposes the available locales with their display names, one entry per input locale', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(i18n.available).toHaveLength(2);
    expect(i18n.available).toEqual(
      expect.arrayContaining([
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Español' },
      ]),
    );
  });

  it('adding a new locale to the input record makes it available with zero registry code', () => {
    const i18n = createI18n(
      { ...LOCALES, fr: { name: 'Français', strings: { greeting: 'Bonjour' } } },
      'fr',
    );
    expect(i18n.locale).toBe('fr');
    expect(i18n.t('greeting')).toBe('Bonjour');
    expect(i18n.available.map((entry) => entry.code).sort()).toEqual(['en', 'es', 'fr']);
  });

  it('falls back to the first available locale when neither the initial locale nor "en" exists', () => {
    const i18n = createI18n({ fr: { name: 'Français', strings: { greeting: 'Bonjour' } } }, 'de');
    expect(i18n.locale).toBe('fr');
  });
});
