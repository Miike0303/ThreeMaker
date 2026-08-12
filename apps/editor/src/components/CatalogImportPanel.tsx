import { useCallback, useState } from 'react';
import {
  ImportClientError,
  importPath,
  isTauriAvailable,
  reloadCatalog,
} from '../catalog-client.js';
import {
  buildImportSummaryMessage,
  importErrorLocaleKey,
  importUnitLocaleKey,
  isImportPathReady,
  trimImportPath,
} from '../catalog-import-panel-helpers.js';
import { formatTemplate } from '../format-template.js';

export interface CatalogImportPanelProps {
  readonly t: (key: string) => string;
  /** Called after a successful import so the catalog browser can reload. */
  readonly onImportComplete?: () => void;
}

type PanelState = 'idle' | 'importing' | 'success' | 'error';

/**
 * Assets-tab import UI: paste a host folder path, run native bulk import,
 * show localized results. Pure logic lives in `catalog-import-panel-helpers.ts`.
 */
export function CatalogImportPanel({ t, onImportComplete }: CatalogImportPanelProps) {
  const [pathInput, setPathInput] = useState('');
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const tauriReady = isTauriAvailable();
  const importReady = tauriReady && isImportPathReady(pathInput);
  const importDisabled = !importReady || panelState === 'importing';

  const handleImport = useCallback(async () => {
    const path = trimImportPath(pathInput);
    if (!path || !tauriReady) return;

    setPanelState('importing');
    setStatusMessage(t('catalog.import.importing'));

    try {
      const summary = await importPath(path);
      await reloadCatalog();
      onImportComplete?.();

      const message = buildImportSummaryMessage(summary);
      const templateValues: Record<string, string | number> = { ...message.values };
      if (message.variant !== 'empty') {
        const { games = 0, assets = 0, tilesets = 0 } = message.values;
        templateValues.gamesUnit = t(importUnitLocaleKey('game', games));
        templateValues.assetsUnit = t(importUnitLocaleKey('asset', assets));
        templateValues.tilesetsUnit = t(importUnitLocaleKey('tileset', tilesets));
      }
      setStatusMessage(formatTemplate(t(message.localeKey), templateValues));
      setPanelState('success');
    } catch (err) {
      console.error('Catalog import failed:', err);
      const code = err instanceof ImportClientError ? err.code : 'generic';
      setStatusMessage(t(importErrorLocaleKey(code)));
      setPanelState('error');
    }
  }, [onImportComplete, pathInput, t, tauriReady]);

  if (!tauriReady) {
    return (
      <div className="catalog-import">
        <p className="catalog-import-status catalog-import-status-warning">
          {t('catalog.import.needsTauri')}
        </p>
      </div>
    );
  }

return (
    <div className="catalog-import">
      <div className="catalog-import-copy">
        <p className="catalog-import-label">{t('catalog.import.pathLabel')}</p>
        <p className="catalog-import-hint">{t('catalog.import.hint')}</p>
      </div>
      <div className="catalog-import-form">
        <div className="catalog-import-row">
          <label className="sr-only" htmlFor="catalog-import-path">
            {t('catalog.import.pathLabel')}
          </label>
          <input
            id="catalog-import-path"
            type="text"
            className="catalog-import-path"
            value={pathInput}
            placeholder={t('catalog.import.pathPlaceholder')}
            onChange={(event) => {
              setPathInput(event.target.value);
              if (panelState !== 'importing') {
                setPanelState('idle');
                setStatusMessage(null);
              }
            }}
            disabled={panelState === 'importing'}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="primary"
            disabled={importDisabled}
            onClick={() => void handleImport()}
          >
            {t('catalog.import.button')}
          </button>
        </div>
      </div>
      <p
        className={`catalog-import-status${
          statusMessage && panelState === 'error' ? ' catalog-import-status-error' : ''
        }${statusMessage && panelState === 'success' ? ' catalog-import-status-success' : ''}`}
        role="status"
      >
        {statusMessage ?? ''}
      </p>
    </div>
  );
}
