import { useCallback, useReducer, useState } from 'react';
import type { AssetRow } from './catalog-client.js';
import { CatalogBrowser } from './components/CatalogBrowser.js';
import { MapViewer } from './components/MapViewer.js';
import { PainterPanel } from './components/PainterPanel.js';
import type { I18n } from './i18n.js';

export interface AppProps {
  readonly i18n: I18n;
  readonly localeStorageKey: string;
}

export function App({ i18n, localeStorageKey }: AppProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  // `i18n` mutates its own current-locale in place (see i18n.ts's
  // `setLocale`); React has no way to observe that mutation on its own, so
  // this counter is bumped on every locale change purely to force a
  // re-render -- the actual translated strings still come from `i18n.t`.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  const handleLocaleChange = useCallback(
    (code: string) => {
      i18n.setLocale(code);
      localStorage.setItem(localeStorageKey, i18n.locale);
      forceRender();
    },
    [i18n, localeStorageKey],
  );

  const t = i18n.t;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <label className="locale-selector">
          {t('locale.selectorLabel')}
          <select value={i18n.locale} onChange={(event) => handleLocaleChange(event.target.value)}>
            {i18n.available.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className="app-main">
        <section className="app-panel app-panel-catalog">
          <CatalogBrowser t={t} onSelectAsset={setSelectedAsset} />
        </section>
        <section className="app-panel app-panel-viewer">
          <MapViewer t={t} />
        </section>
      </main>
      <section className="app-panel-painter">
        <PainterPanel t={t} />
      </section>
      {selectedAsset && <footer className="app-footer">{selectedAsset.relPath}</footer>}
    </div>
  );
}
