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
import { formatTemplate } from '../format-template.js';
import { computePageRange } from '../pagination.js';

export interface CatalogBrowserProps {
  readonly t: (key: string) => string;
  /** Called whenever the user picks a `type: 'tileset'` asset row, so a parent can show a preview. */
  readonly onSelectAsset?: (asset: AssetRow | null) => void;
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/**
 * Thin component: browse cataloged games, filter assets by game+type,
 * paginate results, preview a selected tileset image. All catalog IO goes
 * through `catalog-client.ts`; this component owns only UI state (selected
 * filters/page/asset) and render wiring -- left untested per this repo's
 * convention (pure logic lives in catalog-client.ts's and pagination.ts's
 * tested functions).
 */
export function CatalogBrowser({ t, onSelectAsset }: CatalogBrowserProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [games, setGames] = useState<readonly GameRow[]>([]);
  const [gameId, setGameId] = useState<number | undefined>(undefined);
  const [type, setType] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<readonly AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(100);
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
        const isNotFound = err instanceof CatalogClientError && err.code === 'NotFound';
        if (!isNotFound) console.error('Failed to load the catalog games list:', err);
        setLoadState(isNotFound ? 'empty' : 'error');
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
      page,
    )
      .then((result) => {
        if (cancelled) return;
        setAssets(result.rows);
        setTotal(result.total);
        setPageSize(result.pageSize);
      })
      .catch((err) => {
        console.error('Failed to load a page of catalog assets:', err);
        if (!cancelled) {
          setAssets([]);
          setTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadState, gameId, type, page]);

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

  // Row labels only need an explicit game tag when browsing across ALL
  // games at once (gameId filter absent) -- with a specific game selected,
  // every row already belongs to it, so repeating the title would be noise.
  const gamesById = useMemo(
    () => new Map(games.map((game) => [game.id, game.title ?? game.rootPath])),
    [games],
  );

  const range = computePageRange(page, pageSize, total);

  // Changing a filter always jumps back to page 0 -- batched into the same
  // event handler as the filter change itself (not a separate effect) so
  // the fetch effect below only runs once per filter change, not twice.
  const handleGameChange = (value: string) => {
    setGameId(value ? Number(value) : undefined);
    setPage(0);
  };
  const handleTypeChange = (value: string) => {
    setType(value || undefined);
    setPage(0);
  };

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
          <select value={gameId ?? ''} onChange={(event) => handleGameChange(event.target.value)}>
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
          <select value={type ?? ''} onChange={(event) => handleTypeChange(event.target.value)}>
            <option value="">{t('catalog.allTypes')}</option>
            {KNOWN_ASSET_TYPES.map((known) => (
              <option key={known} value={known}>
                {known}
              </option>
            ))}
          </select>
        </label>
      </div>

      {total === 0 ? (
        <p className="catalog-count">{t('catalog.noResults')}</p>
      ) : (
        <div className="catalog-pagination">
          <p className="catalog-count">
            {formatTemplate(t('catalog.resultRange'), {
              start: range.start,
              end: range.end,
              count: total,
            })}
          </p>
          <button type="button" disabled={!range.hasPrev} onClick={() => setPage((p) => p - 1)}>
            {t('catalog.prevPage')}
          </button>
          <button type="button" disabled={!range.hasNext} onClick={() => setPage((p) => p + 1)}>
            {t('catalog.nextPage')}
          </button>
        </div>
      )}

      <ul className="catalog-asset-list">
        {assets.map((asset) => {
          const gameLabel = gameId === undefined ? gamesById.get(asset.gameId) : undefined;
          return (
            <li key={asset.id}>
              <button
                type="button"
                className={selectedAsset?.id === asset.id ? 'catalog-asset-selected' : undefined}
                onClick={() => setSelectedAsset(asset)}
              >
                {gameLabel ? `${asset.relPath} (${gameLabel})` : asset.relPath}
              </button>
            </li>
          );
        })}
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
