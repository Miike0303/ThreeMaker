import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(APP_DIR, '..', '..');
// The Roseliam fixture lives at the repo root, outside this app's Vite root
// -- see fixtures/README.md. It is never bundled or shipped (git-ignored,
// third-party data); in dev it is only reachable through Vite's /@fs/
// endpoint, gated by server.fs.allow below.
const FIXTURES_DIR = resolve(REPO_ROOT, 'fixtures', 'roseliam').replaceAll('\\', '/');

// Tauri expects a fixed dev server port and a relative frontend build so the
// generated app can load assets correctly regardless of host origin.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo locks files under src-tauri/ while compiling; watching them
      // crashes Vite on Windows with EBUSY.
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      // Allow serving the repo-root fixtures/ folder via /@fs/ in dev (see
      // src/fixture-paths.ts). Dev-server-only: production builds never
      // reference this path, so a missing fixture cannot break `vite build`.
      allow: [APP_DIR, FIXTURES_DIR],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __FIXTURES_DIR__: JSON.stringify(FIXTURES_DIR),
  },
  build: {
    target: ['es2022', 'chrome105'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
