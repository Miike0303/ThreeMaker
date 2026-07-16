import { describe, expect, it } from 'vitest';
import type { ScanErrorRow } from '../src/catalog.js';
import { buildFailuresByCode } from '../src/failures-by-code.js';

function error(id: number, code: string): ScanErrorRow {
  return { id, gameId: null, relPath: `path-${id}`, code, message: 'x' };
}

describe('buildFailuresByCode', () => {
  it('counts only errors recorded after the baseline id, scoping the summary to the current run', () => {
    // Simulates a store where a previous `catalog` run already left errors
    // behind (ids 1-2) before this run's own errors were inserted (ids 3-5).
    const errors: ScanErrorRow[] = [
      error(1, 'bad-header'),
      error(2, 'bad-header'),
      error(3, 'bad-key'),
      error(4, 'bad-key'),
      error(5, 'magic-mismatch'),
    ];

    const result = buildFailuresByCode(errors, 2);

    expect(result).toEqual({ 'bad-key': 2, 'magic-mismatch': 1 });
  });

  it('counts everything when baseline is 0 (empty store before this run)', () => {
    const errors: ScanErrorRow[] = [error(1, 'bad-header'), error(2, 'bad-header')];

    expect(buildFailuresByCode(errors, 0)).toEqual({ 'bad-header': 2 });
  });

  it('returns an empty object when no errors were recorded after the baseline', () => {
    const errors: ScanErrorRow[] = [error(1, 'bad-header'), error(2, 'bad-header')];

    expect(buildFailuresByCode(errors, 2)).toEqual({});
  });
});
