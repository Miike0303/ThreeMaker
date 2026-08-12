/**
 * Pure helpers for the catalog import panel (Assets tab).
 *
 * Path validation, error-code → locale-key mapping, and import-summary →
 * user-facing message descriptors live here so they stay unit-testable without
 * mounting React. `CatalogImportPanel` stays a thin shell over these +
 * `catalog-client.ts` IO.
 */

import type { ImportSummary } from './catalog-client.js';

export type ImportSummaryVariant = 'success' | 'partial' | 'empty';

export interface ImportSummaryMessage {
  readonly variant: ImportSummaryVariant;
  readonly localeKey: string;
  readonly values: Record<string, number>;
}

/** Trim whitespace from a pasted folder path before import. */
export function trimImportPath(raw: string): string {
  return raw.trim();
}

/** True when the trimmed path is non-empty (Import button enable gate). */
export function isImportPathReady(raw: string): boolean {
  return trimImportPath(raw).length > 0;
}

const KNOWN_IMPORT_ERROR_CODES = new Set(['PathNotFound', 'PathNotDirectory', 'StoreFailed']);

/** Map a backend `ImportClientError.code` to a `catalog.import.error.*` locale key. */
export function importErrorLocaleKey(code: string): string {
  if (KNOWN_IMPORT_ERROR_CODES.has(code)) {
    return `catalog.import.error.${code}`;
  }
  return 'catalog.import.error.generic';
}

function hasImportedContent(summary: ImportSummary): boolean {
  return summary.gamesImported > 0 || summary.assetsStored > 0 || summary.tilesetsIngested > 0;
}

function hasFailures(summary: ImportSummary): boolean {
  return summary.gameFailures.length > 0 || summary.scanErrors.length > 0;
}

/** Build the localized status message descriptor for a completed import. */
export function buildImportSummaryMessage(summary: ImportSummary): ImportSummaryMessage {
  if (!hasImportedContent(summary) && !hasFailures(summary)) {
    return { variant: 'empty', localeKey: 'catalog.import.nothingFound', values: {} };
  }

  const values = {
    games: summary.gamesImported,
    assets: summary.assetsStored,
    tilesets: summary.tilesetsIngested,
    gameFailures: summary.gameFailures.length,
    scanErrors: summary.scanErrors.length,
  };

  if (hasFailures(summary)) {
    return { variant: 'partial', localeKey: 'catalog.import.partial', values };
  }

  return {
    variant: 'success',
    localeKey: 'catalog.import.success',
    values: {
      games: summary.gamesImported,
      assets: summary.assetsStored,
      tilesets: summary.tilesetsIngested,
    },
  };
}
