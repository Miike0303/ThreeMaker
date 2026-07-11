/**
 * Catalog data-access boundary for the editor's React UI. Wraps two
 * backends behind one interface:
 *  - the real Tauri IPC commands (`catalog_list_games`/`catalog_list_assets`/
 *    `catalog_get_tileset`/`catalog_asset_store_dir`), used inside the real
 *    Tauri webview host;
 *  - a dev-only HTTP fallback (`/api/dev-catalog/...`, see vite.config.ts's
 *    `devCatalogApiPlugin`), used when `window.__TAURI_INTERNALS__` is
 *    absent -- i.e. under plain `vite dev` with no Tauri host attached
 *    (this slice's headed-browser verification runs exactly that way).
 *
 * The URL-building and query-mapping functions below are pure and unit
 * tested (`test/catalog-client.test.ts`); the actual `invoke`/`fetch` calls
 * are thin IO wrappers, left untested per this repo's convention (see
 * camera-rig.ts's pure/imperative split).
 */

export interface GameRow {
  readonly id: number;
  readonly rootPath: string;
  readonly title: string | null;
  readonly engine: string;
  readonly scannedAt: string;
}

export interface AssetRow {
  readonly id: number;
  readonly gameId: number;
  readonly relPath: string;
  readonly type: string;
  readonly sha256: string;
  readonly wasEncrypted: boolean;
}

export interface AssetPage {
  readonly rows: readonly AssetRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface AssetFilter {
  readonly gameId?: number;
  readonly type?: string;
}

export interface TilesetSheetRow {
  readonly slot: string;
  readonly assetId: number;
  readonly sha256: string;
  readonly relPath: string;
}

export interface TilesetRow {
  readonly id: number;
  readonly gameId: number;
  readonly rpgmId: number | null;
  readonly name: string | null;
  readonly flags: string | null;
  readonly sheets: readonly TilesetSheetRow[];
}

export type CatalogErrorCode = 'NotFound' | 'OpenFailed' | 'QueryFailed';

export class CatalogClientError extends Error {
  readonly code: CatalogErrorCode;

  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = 'CatalogClientError';
    this.code = code;
  }
}

/** Every catalog `assets.type` value `packages/assets/src/catalog.ts`'s `classifyAssetType` can produce, plus its `'other'` fallback -- kept in sync by hand (see that module's `IMAGE_TYPE_MAP`/`AUDIO_TYPE_MAP`). */
export const KNOWN_ASSET_TYPES: readonly string[] = [
  'tileset',
  'parallax',
  'picture',
  'character',
  'face',
  'enemy',
  'sv_actor',
  'sv_enemy',
  'animation',
  'battleback1',
  'battleback2',
  'title1',
  'title2',
  'system',
  'bgm',
  'bgs',
  'me',
  'se',
  'other',
];

const DEV_API_BASE = '/api/dev-catalog';

/** True only inside the real Tauri webview host (see `global.d.ts`). */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

/** Pure: builds the dev-fallback `/api/dev-catalog/assets` URL for a filter+page, omitting absent filter fields. */
export function buildDevAssetsUrl(filter: AssetFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.gameId !== undefined) params.set('gameId', String(filter.gameId));
  if (filter.type !== undefined) params.set('type', filter.type);
  params.set('page', String(page));
  return `${DEV_API_BASE}/assets?${params.toString()}`;
}

/** Pure: builds the dev-fallback object-bytes URL for a preview `<img>`/`<audio>` src. */
export function buildDevObjectUrl(sha256: string, kind: string): string {
  const params = new URLSearchParams({ kind });
  return `${DEV_API_BASE}/object/${sha256}?${params.toString()}`;
}

/** Pure: the dev-fallback games-list URL (no query params, listed for symmetry with the other builders). */
export function buildDevGamesUrl(): string {
  return `${DEV_API_BASE}/games`;
}

async function assertOk(response: Response): Promise<Response> {
  if (response.status === 404) {
    const body = (await response.json().catch(() => ({ code: 'NotFound' }))) as {
      code?: CatalogErrorCode;
    };
    throw new CatalogClientError(body.code ?? 'NotFound', 'Catalog not found.');
  }
  if (!response.ok) {
    throw new CatalogClientError('QueryFailed', `Request failed: ${response.status}`);
  }
  return response;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    const payload = err as { code?: CatalogErrorCode; message?: string } | string;
    if (typeof payload === 'object' && payload?.code) {
      throw new CatalogClientError(payload.code, payload.message ?? payload.code);
    }
    throw new CatalogClientError('QueryFailed', String(payload));
  }
}

export async function listGames(): Promise<readonly GameRow[]> {
  if (isTauriAvailable()) return invokeTauri<GameRow[]>('catalog_list_games');
  const response = await assertOk(await fetch(buildDevGamesUrl()));
  return (await response.json()) as GameRow[];
}

export async function listAssets(filter: AssetFilter, page: number): Promise<AssetPage> {
  if (isTauriAvailable()) return invokeTauri<AssetPage>('catalog_list_assets', { filter, page });
  const response = await assertOk(await fetch(buildDevAssetsUrl(filter, page)));
  return (await response.json()) as AssetPage;
}

export async function getTileset(id: number): Promise<TilesetRow | null> {
  if (isTauriAvailable()) return invokeTauri<TilesetRow | null>('catalog_get_tileset', { id });
  // Dev fallback has no populated tilesets endpoint yet (tileset_sheets isn't
  // populated until Slice 4) -- always empty, consistent with the real
  // catalog's current state.
  return null;
}

/**
 * Resolves a browser-usable URL for an object's raw bytes (image preview).
 * In the real Tauri host this goes through the asset protocol
 * (`convertFileSrc`, scoped to the asset-store dir per tauri.conf.json); in
 * the dev fallback it hits the same-origin `/api/dev-catalog/object/:sha256`
 * endpoint.
 */
export async function objectPreviewUrl(sha256: string, kind: string): Promise<string> {
  if (!isTauriAvailable()) return buildDevObjectUrl(sha256, kind);
  const storeDir = await invokeTauri<string>('catalog_asset_store_dir');
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const objectPath = `${storeDir}/objects/${sha256.slice(0, 2)}/${sha256}`;
  return convertFileSrc(objectPath);
}
