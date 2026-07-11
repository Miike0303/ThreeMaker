import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  DevCatalogReader,
  isValidSha256,
  SchemaVersionMismatchError,
} from './dev-server/catalog-api.js';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(APP_DIR, '..', '..');
// mz-project1 fixture (see fixtures/README.md): reused here as the Slice 3
// map-viewer's bundled fixture map -- the real catalog's `tilesets`/
// `tileset_sheets` tables aren't populated yet (Slice 4 territory, per
// design), so there is no catalog-composed map to view yet. Dev-only, same
// caveats as apps/desktop's fixture loading.
const MZ_FIXTURES_DIR = resolve(REPO_ROOT, 'fixtures', 'mz-project1').replaceAll('\\', '/');

const DEV_CATALOG_DB_PATH =
  process.env.THREEMAKER_CATALOG_DB_PATH ??
  resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? '.',
    '.threemaker',
    'asset-store',
    'catalog.db',
  );
const DEV_ASSET_STORE_DIR = resolve(dirname(DEV_CATALOG_DB_PATH));

// Mirrors apps/editor/src-tauri/src/catalog_ipc.rs's PAGE_SIZE (100) -- no
// cross-language sharing needed for a single fixed constant; keep both in
// sync by hand if this value is ever tuned.
const DEV_PAGE_SIZE = 100;

const OBJECT_KIND_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  other: 'application/octet-stream',
};

/**
 * Dev-only fallback for the catalog IPC boundary. Tauri's `invoke` bridge
 * (`window.__TAURI_INTERNALS__`) is only injected inside the real Tauri
 * webview host (`tauri dev`) -- it does NOT exist when the app is served by
 * plain `vite dev` (e.g. this slice's headed-Edge/Puppeteer verification,
 * which drives a normal Chromium-family browser, not the Tauri webview
 * process). Rather than leave the catalog browser non-functional outside a
 * full Tauri host, this dev-only Express-less middleware exposes the SAME
 * three query shapes (`games`, `assets` with filter+page, `tileset(id)`)
 * plus a raw-bytes object endpoint for image previews, backed by
 * `@threemaker/assets/node`'s `Catalog` (the same reader the Rust IPC layer
 * re-implements against the on-disk schema -- see catalog_ipc.rs's module
 * doc for the schema-duplication note). Never present in a production
 * build: this plugin only registers `configureServer` middleware, which Vite
 * never invokes outside `vite dev`/`vite preview`.
 */
function devCatalogApiPlugin(): Plugin {
  return {
    name: 'threemaker-dev-catalog-api',
    configureServer(server) {
      server.middlewares.use('/api/dev-catalog', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const segments = url.pathname.split('/').filter(Boolean);

        if (!existsSync(DEV_CATALOG_DB_PATH)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ code: 'NotFound' }));
          return;
        }

        let catalog: DevCatalogReader;
        try {
          catalog = new DevCatalogReader(DEV_CATALOG_DB_PATH);
        } catch (err) {
          if (err instanceof SchemaVersionMismatchError) {
            res.statusCode = 409;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ code: 'SchemaVersionMismatch', message: err.message }));
            return;
          }
          throw err;
        }

        try {
          if (segments.length === 1 && segments[0] === 'games') {
            const games = catalog.listGames();
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(games));
            return;
          }

          if (segments.length === 1 && segments[0] === 'assets') {
            const gameId = url.searchParams.get('gameId');
            const type = url.searchParams.get('type');
            const filter = {
              ...(gameId ? { gameId: Number(gameId) } : {}),
              ...(type ? { type } : {}),
            };
            const page = Number(url.searchParams.get('page') ?? '0');
            // SQL-level LIMIT/OFFSET pagination (Catalog.listAssets'
            // pagination param) -- never loads the full filtered table into
            // Node memory just to slice it in JS.
            const rows = catalog.listAssets(filter, { page, pageSize: DEV_PAGE_SIZE });
            const total = catalog.countAssets(filter);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ rows, total, page, pageSize: DEV_PAGE_SIZE }));
            return;
          }

          if (segments.length === 2 && segments[0] === 'object') {
            const sha256 = segments[1] ?? '';
            const kind = url.searchParams.get('kind') ?? 'other';
            if (!isValidSha256(sha256)) {
              res.statusCode = 400;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ code: 'InvalidSha256' }));
              return;
            }
            const bytesPath = catalog.objectPath(DEV_ASSET_STORE_DIR, sha256);
            if (!existsSync(bytesPath)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader(
              'content-type',
              OBJECT_KIND_CONTENT_TYPE[kind] ?? 'application/octet-stream',
            );
            res.end(readFileSync(bytesPath));
            return;
          }

          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ code: 'NotFound' }));
        } finally {
          catalog.close();
        }
      });
    },
  };
}

// Tauri expects a fixed dev server port and a relative frontend build so the
// generated app can load assets correctly regardless of host origin. Port
// 1421 (not 1420) so the editor's dev server never collides with
// apps/desktop's.
export default defineConfig({
  clearScreen: false,
  plugins: [react(), devCatalogApiPlugin()],
  server: {
    port: 1421,
    strictPort: true,
    watch: {
      // Cargo locks files under src-tauri/ while compiling; watching them
      // crashes Vite on Windows with EBUSY.
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      allow: [APP_DIR, MZ_FIXTURES_DIR],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __MZ_FIXTURES_DIR__: JSON.stringify(MZ_FIXTURES_DIR),
  },
  build: {
    target: ['es2022', 'chrome105'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
