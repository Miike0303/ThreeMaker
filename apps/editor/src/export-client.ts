/**
 * RPGM export client (Slice 5: "rpgm-export"). Dev-only HTTP fallback
 * (`/api/dev-export/run`, see `dev-server/export-api.ts` +
 * `vite.config.ts`'s `devExportApiPlugin`) is the only wired-and-verified
 * path this slice -- same known-gap shape as `map-client.ts`'s save/load:
 *
 * ponytail / KNOWN GAP: the real Tauri host export path
 * (`@tauri-apps/plugin-fs` + a Rust `copy_dir` command, per design) is
 * intentionally NOT wired this slice -- no filesystem/shell capability is
 * declared in `tauri.conf.json`, and it cannot be verified without a real
 * Tauri run. `exportProject` throws a clear "not implemented" error under
 * `isTauriAvailable()` rather than silently no-op or ship unverified
 * capability config. Flagged as remaining work for a future slice/pass.
 */

import type { MapDocument } from '@threemaker/map-format';
import { serializeMapDocument } from '@threemaker/map-format';
import { isTauriAvailable } from './catalog-client.js';

const DEV_EXPORT_API_BASE = '/api/dev-export';

export type ExportClientErrorCode = 'TemplateNotConfigured' | 'ExportFailed' | 'NotImplemented';

export class ExportClientError extends Error {
  readonly code: ExportClientErrorCode;

  constructor(code: ExportClientErrorCode, message: string) {
    super(message);
    this.name = 'ExportClientError';
    this.code = code;
  }
}

export interface ExportProjectResult {
  readonly outDir: string;
  readonly markerValueUsed: string;
  readonly copiedSheetFiles: readonly string[];
  readonly report: {
    readonly droppedSemanticCount: number;
    readonly composedSlots: readonly string[];
    readonly notes: readonly string[];
  };
}

/** Exports `doc` to a real RPG Maker MZ project folder. Throws `ExportClientError` on failure. */
export async function exportProject(doc: MapDocument): Promise<ExportProjectResult> {
  if (isTauriAvailable()) {
    throw new ExportClientError(
      'NotImplemented',
      'Exporting from inside the real Tauri host is not implemented yet -- this slice only wires the dev-fallback HTTP path. See export-client.ts.',
    );
  }

  const response = await fetch(`${DEV_EXPORT_API_BASE}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: serializeMapDocument(doc),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<ExportProjectResult> & {
    code?: ExportClientErrorCode;
    message?: string;
  };

  if (!response.ok) {
    throw new ExportClientError(
      payload.code ?? 'ExportFailed',
      payload.message ?? `Export failed: HTTP ${response.status}`,
    );
  }

  return payload as ExportProjectResult;
}
