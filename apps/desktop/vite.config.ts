import { defineConfig } from 'vite';

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
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2022', 'chrome105'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
