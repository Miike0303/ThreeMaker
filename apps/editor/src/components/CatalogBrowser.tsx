import { useEffect, useMemo, useState } from 'react';
import {
  type AssetRow,
  CatalogClientError,
  type GameRow,
  KNOWN_ASSET_TYPES,
  listAssets,
  listGames,
  objectPreviewUrl,
} from '../catalog-client.js';

export interface CatalogBrowserProps {
  readonly t: (key: string) => string;
  /** Called whenever the user picks a `type: 'tileset'` asset row, so a parent can show a preview. */
  readonly onSelectAsset?: (asset: AssetRow | null) => void;
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/**
 * Thin component: browse cataloged games, filter assets by game+type,
 * preview a selected tileset image. All catalog IO goes through
 * `catalog-client.ts`; this component owns only UI state (selected
 * filters/asset) and render wiring -- left untested per this repo's
 * convention (pure logic lives in catalog-client.ts's tested builders).
 */
export function CatalogBrowser({ t, onSelectAsset }: CatalogBrowserProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [games, setGames] = useState<readonly GameRow[]>([]);
  const [gameId, setGameId] = useState<number | undefined>(undefined);
  const [type, setType] = useState<string | undefined>(undefined);
  const [assets, setAssets] = useState<readonly AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGames()
      .then((rows) => {
        if (cancelled) return;
        setGames(rows);
        setLoadState(rows.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState(
          err instanceof CatalogClientError && err.code === 'NotFound' ? 'empty' : 'error',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadState !== 'ready') return;
    let cancelled = false;
    listAssets(
      { ...(gameId !== undefined ? { gameId } : {}), ...(type !== undefined ? { type } : {}) },
      0,
    )
      .then((page) => {
        if (cancelled) return;
        setAssets(page.rows);
        setTotal(page.total);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadState, gameId, type]);

  useEffect(() => {
    onSelectAsset?.(selectedAsset);
    if (selectedAsset?.type !== 'tileset') {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    objectPreviewUrl(selectedAsset.sha256, 'png')
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAsset, onSelectAsset]);

  const gameOptions = useMemo(
    () => games.map((game) => ({ id: game.id, label: game.title ?? game.rootPath })),
    [games],
  );

  if (loadState === 'loading') {
    return <p className="catalog-status">{t('catalog.loading')}</p>;
  }

  if (loadState === 'empty') {
    return <p className="catalog-status">{t('catalog.empty')}</p>;
  }

  if (loadState === 'error') {
    return <p className="catalog-status catalog-status-error">{t('catalog.error')}</p>;
  }

  return (
    <div className="catalog-browser">
      <div className="catalog-filters">
        <label>
          {t('catalog.filterGame')}
          <select
            value={gameId ?? ''}
            onChange={(event) =>
              setGameId(event.target.value ? Number(event.target.value) : undefined)
            }
          >
            <option value="">{t('catalog.allGames')}</option>
            {gameOptions.map((game) => (
              <option key={game.id} value={game.id}>
                {game.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('catalog.filterType')}
          <select value={type ?? ''} onChange={(event) => setType(event.target.value || undefined)}>
            <option value="">{t('catalog.allTypes')}</option>
            {KNOWN_ASSET_TYPES.map((known) => (
              <option key={known} value={known}>
                {known}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="catalog-count">{t('catalog.resultCount').replace('{count}', String(total))}</p>

      <ul className="catalog-asset-list">
        {assets.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className={selectedAsset?.id === asset.id ? 'catalog-asset-selected' : undefined}
              onClick={() => setSelectedAsset(asset)}
            >
              {asset.relPath}
            </button>
          </li>
        ))}
      </ul>

      {previewUrl && selectedAsset && (
        <div className="catalog-preview">
          <p>{selectedAsset.relPath}</p>
          <img src={previewUrl} alt={selectedAsset.relPath} className="catalog-preview-image" />
        </div>
      )}
    </div>
  );
}
