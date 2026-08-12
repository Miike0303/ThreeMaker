import { useEffect, useMemo, useState } from 'react';
import {
  type AssetRow,
  buildDevObjectUrl,
  CatalogClientError,
  type GameRow,
  getAssetStoreDir,
  isTauriAvailable,
  KNOWN_ASSET_TYPES,
  listAssets,
  listGames,
  objectPreviewUrl,
  objectPreviewUrlFromStoreDir,
} from '../catalog-client.js';
import { formatTemplate } from '../format-template.js';
import { computePageRange } from '../pagination.js';

export interface CatalogBrowserProps {
  readonly t: (key: string) => string;
  /** Called whenever the user picks a tileset (or any) asset row for parent preview. */
  readonly onSelectAsset?: (asset: AssetRow | null) => void;
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

const AUDIO_ASSET_TYPES = new Set<string>(['bgm', 'bgs', 'me', 'se']);

/** Prefer art-first browsing; full library still available via All. */
const TYPE_CHIP_ORDER: readonly string[] = [
  'tileset',
  'character',
  'face',
  'picture',
  'parallax',
  'enemy',
  'animation',
  'bgm',
  'bgs',
  'se',
  'me',
];

function isImagePreviewAsset(asset: AssetRow): boolean {
  return !AUDIO_ASSET_TYPES.has(asset.type);
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function dirname(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(0, i) : '';
}

function CatalogAssetThumb({
  asset,
  storeDir,
}: {
  readonly asset: AssetRow;
  readonly storeDir: string | null;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isImagePreviewAsset(asset)) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    const resolve = isTauriAvailable()
      ? storeDir
        ? objectPreviewUrlFromStoreDir(storeDir, asset.sha256)
        : Promise.resolve(null)
      : Promise.resolve(buildDevObjectUrl(asset.sha256, 'png'));
    resolve
      .then((url) => {
        if (!cancelled) setThumbUrl(url);
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, storeDir]);

  if (AUDIO_ASSET_TYPES.has(asset.type)) {
    return (
      <span className="catalog-asset-glyph catalog-asset-glyph-audio" aria-hidden>
        ♪
      </span>
    );
  }

  if (!thumbUrl || hidden) {
    return (
      <span className="catalog-asset-glyph" aria-hidden>
        {asset.type.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={thumbUrl}
      alt=""
      aria-hidden
      loading="lazy"
      width={36}
      height={36}
      className="catalog-asset-thumb"
      onError={() => setHidden(true)}
    />
  );
}

/**
 * Browse cataloged games, filter assets by game+type, paginate, preview.
 * Pure IO lives in catalog-client.ts; this component owns UI state only.
 */
export function CatalogBrowser({ t, onSelectAsset }: CatalogBrowserProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [games, setGames] = useState<readonly GameRow[]>([]);
  const [gameId, setGameId] = useState<number | undefined>(undefined);
  // Default to tileset so Assets opens on art, not 200k audio paths.
  const [type, setType] = useState<string | undefined>('tileset');
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<readonly AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [storeDir, setStoreDir] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    getAssetStoreDir()
      .then((dir) => {
        if (!cancelled) setStoreDir(dir);
      })
      .catch((err) => {
        console.error('Failed to resolve catalog asset store directory:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!selectedAsset || !isImagePreviewAsset(selectedAsset)) {
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

  const gamesById = useMemo(
    () => new Map(games.map((game) => [game.id, game.title ?? game.rootPath])),
    [games],
  );

  const typeChips = useMemo(() => {
    const known = new Set(KNOWN_ASSET_TYPES);
    const ordered = TYPE_CHIP_ORDER.filter((id) => known.has(id));
    for (const id of KNOWN_ASSET_TYPES) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }, []);

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.relPath.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (gamesById.get(a.gameId) ?? '').toLowerCase().includes(q),
    );
  }, [assets, query, gamesById]);

  const range = computePageRange(page, pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const handleGameChange = (value: string) => {
    setGameId(value ? Number(value) : undefined);
    setPage(0);
    setSelectedAsset(null);
  };
  const handleTypeChange = (value: string | undefined) => {
    setType(value);
    setPage(0);
    setSelectedAsset(null);
  };

  if (loadState === 'loading') {
    return <p className="catalog-status">{t('catalog.loading')}</p>;
  }

  if (loadState === 'empty') {
    return (
      <div className="catalog-empty-card">
        <p className="catalog-empty-title">{t('catalog.empty.title')}</p>
        <p className="catalog-empty-body">{t('catalog.empty.body')}</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return <p className="catalog-status catalog-status-error">{t('catalog.error')}</p>;
  }

  const selectedIsAudio = selectedAsset ? AUDIO_ASSET_TYPES.has(selectedAsset.type) : false;

  return (
    <div className="catalog-browser">
      <div className="catalog-toolbar">
        <div className="catalog-toolbar-title">{t('catalog.toolbar')}</div>
        <div className="catalog-filters">
          <label className="catalog-filter">
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
          <label className="catalog-filter catalog-filter-search">
            <span className="sr-only">Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this page…"
              className="catalog-search"
              spellCheck={false}
            />
          </label>
        </div>
      </div>

      <div className="catalog-type-chips" role="toolbar" aria-label={t('catalog.typeChips')}>
        <button
          type="button"
          className={`catalog-type-chip${!type ? ' catalog-type-chip-active' : ''}`}
          onClick={() => handleTypeChange(undefined)}
        >
          {t('catalog.type.all')}
        </button>
        {typeChips.map((known) => (
          <button
            key={known}
            type="button"
            className={`catalog-type-chip${type === known ? ' catalog-type-chip-active' : ''}`}
            onClick={() => handleTypeChange(known)}
          >
            {known}
          </button>
        ))}
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
            <span className="catalog-count-sep">·</span>
            {formatTemplate(t('catalog.pageOf'), { page: page + 1, pages: pageCount })}
          </p>
          <div className="catalog-pagination-actions">
            <button
              type="button"
              className="ide-btn-quiet"
              disabled={!range.hasPrev}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('catalog.prevPage')}
            </button>
            <button
              type="button"
              className="ide-btn-quiet"
              disabled={!range.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('catalog.nextPage')}
            </button>
          </div>
        </div>
      )}

      <div className="catalog-browser-body">
        <ul className="catalog-asset-list">
          {filteredAssets.map((asset) => {
            const gameLabel = gameId === undefined ? gamesById.get(asset.gameId) : undefined;
            const name = basename(asset.relPath);
            const folder = dirname(asset.relPath);
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  className={selectedAsset?.id === asset.id ? 'catalog-asset-selected' : undefined}
                  onClick={() => setSelectedAsset(asset)}
                >
                  <CatalogAssetThumb asset={asset} storeDir={storeDir} />
                  <span className="catalog-asset-meta">
                    <span className="catalog-asset-name">{name}</span>
                    <span className="catalog-asset-sub">
                      <span className="catalog-asset-type-badge">{asset.type}</span>
                      {folder ? <span className="catalog-asset-folder">{folder}</span> : null}
                      {gameLabel ? <span className="catalog-asset-game">{gameLabel}</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="catalog-preview-pane">
          <div className="catalog-preview-heading">{t('catalog.preview.heading')}</div>
          {previewUrl && selectedAsset ? (
            <div className="catalog-preview">
              <p className="catalog-preview-path">{selectedAsset.relPath}</p>
              <div className="catalog-preview-stage">
                <img
                  src={previewUrl}
                  alt={selectedAsset.relPath}
                  className="catalog-preview-image"
                />
              </div>
              <div className="catalog-preview-meta">
                <span className="catalog-asset-type-badge">{selectedAsset.type}</span>
                <span>{basename(selectedAsset.relPath)}</span>
              </div>
            </div>
          ) : selectedIsAudio && selectedAsset ? (
            <div className="catalog-preview-empty-card">
              <div className="catalog-preview-empty-icon" aria-hidden>
                ♪
              </div>
              <p className="catalog-preview-empty-title">{basename(selectedAsset.relPath)}</p>
              <p className="catalog-preview-empty">{t('catalog.preview.audio')}</p>
            </div>
          ) : (
            <div className="catalog-preview-empty-card">
              <div className="catalog-preview-empty-icon catalog-preview-empty-icon-art" aria-hidden>
                ▦
              </div>
              <p className="catalog-preview-empty">{t('catalog.preview.empty')}</p>
              <p className="catalog-preview-tip">{t('catalog.preview.pickType')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
