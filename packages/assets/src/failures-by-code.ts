import type { ScanErrorRow } from './catalog.js';

/**
 * Aggregates per-run failure counts by `scan_errors.code`, counting only
 * errors with `id` greater than `baselineId`. Capture `baselineId` via
 * `Catalog.getMaxScanErrorId()` before the run starts; per-game and
 * discovery-time rows are cleared at the start of each ingest/import pass,
 * so counting rows above the baseline reports this run's failures only.
 *
 * Kept in its own module (not inline in `cli.ts`) so it can be unit-tested
 * directly without importing `cli.ts`, which runs `main()` as a top-level
 * side effect on import.
 */
export function buildFailuresByCode(
  errors: readonly ScanErrorRow[],
  baselineId: number,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const error of errors) {
    if (error.id <= baselineId) continue;
    counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}
