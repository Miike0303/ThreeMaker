import { useCallback, useMemo, useReducer, useState } from 'react';
import type { AssetRow } from './catalog-client.js';
import { CatalogBrowser } from './components/CatalogBrowser.js';
import { MapViewer } from './components/MapViewer.js';
import { PainterPanel } from './components/PainterPanel.js';
import type { I18n } from './i18n.js';
import {
  footerStatusKind,
  type WorkspaceId,
  workspaceMountContract,
} from './workspace-panels.js';

export interface AppProps {
  readonly i18n: I18n;
  readonly localeStorageKey: string;
}

/**
 * Engine-style app shell: top brand bar + workspace tabs (Map Editor | Assets),
 * matching the Unity/GameMaker "one focus viewport" habit.
 */
export function App({ i18n, localeStorageKey }: AppProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceId>('map');
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
  // Always mount both panels — hide inactive via CSS + inert (see workspace-panels.ts).
  const panels = useMemo(() => workspaceMountContract(workspace), [workspace]);
  const statusKind = footerStatusKind(workspace, selectedAsset !== null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <span className="app-header-mark" aria-hidden />
          <div className="app-header-titles">
            <h1>{t('app.title')}</h1>
            <span className="app-header-subtitle">{t('app.brand.subtitle')}</span>
          </div>
        </div>
        <nav className="app-workspace-tabs" aria-label={t('app.workspace')}>
          <button
            type="button"
            className={`app-workspace-tab${workspace === 'map' ? ' app-workspace-tab-active' : ''}`}
            onClick={() => setWorkspace('map')}
          >
            {t('app.workspace.map')}
          </button>
          <button
            type="button"
            className={`app-workspace-tab${workspace === 'assets' ? ' app-workspace-tab-active' : ''}`}
            onClick={() => setWorkspace('assets')}
          >
            {t('app.workspace.assets')}
          </button>
        </nav>
        <div className="app-header-spacer" />
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

      <div className="app-body">
        {panels.map.alwaysMounted && (
          <div
            className={panels.map.className}
            aria-hidden={panels.map.ariaHidden}
            inert={panels.map.inert ? true : undefined}
          >
            <PainterPanel t={t} />
          </div>
        )}
        {panels.assets.alwaysMounted && (
          <div
            className={panels.assets.className}
            aria-hidden={panels.assets.ariaHidden}
            inert={panels.assets.inert ? true : undefined}
          >
            <section className="app-panel app-panel-catalog">
              <CatalogBrowser t={t} onSelectAsset={setSelectedAsset} />
            </section>
            <section className="app-panel app-panel-viewer">
              <MapViewer t={t} />
            </section>
          </div>
        )}
      </div>

      <footer className="app-footer">
        {statusKind === 'asset-path' && selectedAsset
          ? selectedAsset.relPath
          : statusKind === 'map'
            ? t('app.status.map')
            : t('app.status.assets')}
      </footer>
    </div>
  );
}
