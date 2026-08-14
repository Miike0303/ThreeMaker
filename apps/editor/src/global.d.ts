declare global {
  // `__MZ_FIXTURES_DIR__` is injected by Vite's `define` in vite.config.ts:
  // the absolute, forward-slash path to `fixtures/mz-project1/` on the
  // machine running `vite dev`. Only meaningful in dev -- there is no
  // equivalent in a production build. See `map-viewer.ts` and `MapViewer.tsx`.
  const __MZ_FIXTURES_DIR__: string;

  interface Window {
    /**
     * Set when running inside the real Tauri webview host (injected by the
     * Tauri runtime itself, not by this app). Absent under plain `vite dev`
     * (e.g. this slice's headed-browser verification), which is exactly the
     * signal `catalog-client.ts` uses to fall back to the dev-only HTTP API
     * (see vite.config.ts's `devCatalogApiPlugin`).
     */
    __TAURI_INTERNALS__?: unknown;

    /**
     * DEV-only live render counters, mirroring desktop's
     * `window.__threemaker_debug` seam: a headless check cannot tell a working
     * painter from a dead one by screenshotting the canvas, because
     * `WebGPURenderer` defaults to `alpha: true` and the page background shows
     * straight through an unrendered surface. Draw calls are the honest signal.
     * Read by `apps/editor/test/painter-canvas.smoke.mjs`.
     */
    __threemaker_painter_debug?: () => {
      readonly ready: boolean;
      readonly drawCalls: number;
      readonly triangles: number;
    };
  }
}

export {};
