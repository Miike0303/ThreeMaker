import { useState } from 'react';
import type { AssetRow } from './catalog-client.js';
import { CatalogBrowser } from './components/CatalogBrowser.js';
import { MapViewer } from './components/MapViewer.js';

// Placeholder identity translator -- Commit C wires the real en/es i18n
// (createI18n, same pattern as apps/desktop/src/i18n.ts) in its place.
const t = (key: string): string => key;

export function App() {
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ThreeMaker Editor</h1>
      </header>
      <main className="app-main">
        <section className="app-panel app-panel-catalog">
          <CatalogBrowser t={t} onSelectAsset={setSelectedAsset} />
        </section>
        <section className="app-panel app-panel-viewer">
          <MapViewer t={t} />
        </section>
      </main>
      {selectedAsset && <footer className="app-footer">{selectedAsset.relPath}</footer>}
    </div>
  );
}
