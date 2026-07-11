// Copied from apps/desktop/src/i18n.ts (identical pure factory, no
// framework/DOM coupling — safe to duplicate for this slice). Ponytail: no
// shared package exists yet for cross-app UI utilities; extract this (and
// clamp.ts) into one if a third app ever needs the same pattern.

/** One JSON locale file's shape: a display name plus its translated strings. */
export interface Locale {
  readonly name: string;
  readonly strings: Record<string, string>;
}

export interface AvailableLocale {
  readonly code: string;
  readonly name: string;
}

export interface I18n {
  /** Looks up `key` in the current locale, falling back to "en", then to `key` itself. */
  t(key: string): string;
  /** Switches the active locale. A `code` not present in the input `locales` is a no-op. */
  setLocale(code: string): void;
  readonly locale: string;
  readonly available: readonly AvailableLocale[];
}

const FALLBACK_LOCALE_CODE = 'en';

function resolveInitialLocale(
  locales: Record<string, Locale>,
  initial: string | undefined,
): string {
  if (initial && locales[initial]) return initial;
  if (locales[FALLBACK_LOCALE_CODE]) return FALLBACK_LOCALE_CODE;
  const [firstCode] = Object.keys(locales);
  if (!firstCode) {
    throw new Error('createI18n requires at least one locale.');
  }
  return firstCode;
}

/**
 * Pure, testable i18n factory. Fallback chain for `t(key)`: current locale ->
 * "en" -> the key itself (so a missing translation is visible, not blank).
 * Adding a new locale is purely a matter of the caller passing another entry
 * in `locales` -- this module has no hardcoded language list.
 */
export function createI18n(locales: Record<string, Locale>, initial?: string): I18n {
  let currentCode = resolveInitialLocale(locales, initial);

  return {
    t(key: string): string {
      const current = locales[currentCode];
      if (current?.strings[key] !== undefined) return current.strings[key];

      const fallback = locales[FALLBACK_LOCALE_CODE];
      if (fallback?.strings[key] !== undefined) return fallback.strings[key];

      return key;
    },
    setLocale(code: string): void {
      if (locales[code]) currentCode = code;
    },
    get locale(): string {
      return currentCode;
    },
    get available(): readonly AvailableLocale[] {
      return Object.entries(locales).map(([code, locale]) => ({ code, name: locale.name }));
    },
  };
}
