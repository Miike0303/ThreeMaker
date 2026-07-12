/**
 * Desktop-local copy of the editor's `catalog-client.ts` Tauri-host check
 * (loop-crear-jugar design, "Desktop load gating": "new
 * `apps/desktop/src/tauri-env.ts`, copy of catalog-client's check"). Kept
 * duplicated rather than shared cross-app for the same reason as
 * `map-file.ts`'s `MAP_FILE_RELATIVE` constant -- no shared package exists
 * for this app-boundary crossing.
 */

/** True only inside the real Tauri webview host (injected by the Tauri runtime itself). Absent under plain `vite dev`/`vite build`. */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}
