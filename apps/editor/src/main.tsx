import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import type { Locale } from './i18n.js';
import { createI18n } from './i18n.js';

const LOCALE_STORAGE_KEY = 'threemaker-editor:locale';

// `import.meta.glob` with `eager: true` turns every `./locales/*.json` file
// into an entry here at build time -- dropping in a new locale JSON file is
// the only step needed to add a language, no registry code to touch (same
// convention as apps/desktop/src/main.ts).
const localeModules = import.meta.glob('./locales/*.json', { eager: true }) as Record<
  string,
  { default: Locale }
>;

function localesFromModules(modules: Record<string, { default: Locale }>): Record<string, Locale> {
  const locales: Record<string, Locale> = {};
  for (const [path, module] of Object.entries(modules)) {
    const code = /([\w-]+)\.json$/.exec(path)?.[1];
    if (!code) continue;
    locales[code] = module.default;
  }
  return locales;
}

const i18n = createI18n(
  localesFromModules(localeModules),
  localStorage.getItem(LOCALE_STORAGE_KEY) ?? undefined,
);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root container element.');

createRoot(container).render(
  <StrictMode>
    <App i18n={i18n} localeStorageKey={LOCALE_STORAGE_KEY} />
  </StrictMode>,
);
