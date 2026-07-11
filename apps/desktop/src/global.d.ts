import type { Node } from 'three/webgpu';

declare global {
  // `__FIXTURES_DIR__` is injected by Vite's `define` in vite.config.ts: the
  // absolute, forward-slash path to `fixtures/roseliam/` on the machine
  // running `vite dev`. Only meaningful in dev (see fixture-paths.ts) -- there
  // is no equivalent in a production build.
  const __FIXTURES_DIR__: string;

  // Same as `__FIXTURES_DIR__`, but for the mz-project1 fixture (genuine MZ
  // dir/data layout) -- see fixture-paths.ts and vite.config.ts.
  const __MZ_FIXTURES_DIR__: string;

  interface Window {
    /**
     * Dev-only hook exposing the renderer, so a headless visual check can
     * inspect which backend (WebGPU/WebGL2) actually got used. Only set when
     * `import.meta.env.DEV` (see main.ts); absent in production builds.
     */
    __hd2d?: { renderer: import('three/webgpu').Renderer };

    /**
     * Dev-only debug counters for the chunk-streaming headless checks. Only
     * set when `import.meta.env.DEV` (see main.ts); absent in production
     * builds. Values are read live via getters, so a check can sample them
     * before and after walking.
     */
    __threemaker_debug?: {
      /** Chunks with live GPU geometry right now. */
      readonly liveChunks: number;
      /** Draw calls issued for the last rendered frame. */
      readonly drawCalls: number;
      /** Display name of the currently loaded map. */
      readonly mapName: string;
      /** The character's current integer tile position. */
      readonly tile: { readonly x: number; readonly y: number };
    };
  }
}

declare module 'three/webgpu' {
  interface Scene {
    /** Not yet declared in @types/three's Scene class; read/written by the WebGPU node renderer at runtime (see hd2d-pipeline.ts). */
    fogNode: Node | null;
  }
}
