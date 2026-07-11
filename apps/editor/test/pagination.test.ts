import { describe, expect, it } from 'vitest';
import { computePageRange } from '../src/pagination.js';

describe('computePageRange', () => {
  it('computes the first page of a multi-page result set', () => {
    expect(computePageRange(0, 100, 250)).toEqual({
      start: 1,
      end: 100,
      hasPrev: false,
      hasNext: true,
    });
  });

  it('computes a middle page', () => {
    expect(computePageRange(1, 100, 250)).toEqual({
      start: 101,
      end: 200,
      hasPrev: true,
      hasNext: true,
    });
  });

  it('computes the last (partial) page', () => {
    expect(computePageRange(2, 100, 250)).toEqual({
      start: 201,
      end: 250,
      hasPrev: true,
      hasNext: false,
    });
  });

  it('handles a single page smaller than pageSize', () => {
    expect(computePageRange(0, 100, 42)).toEqual({
      start: 1,
      end: 42,
      hasPrev: false,
      hasNext: false,
    });
  });

  it('handles zero results', () => {
    expect(computePageRange(0, 100, 0)).toEqual({
      start: 0,
      end: 0,
      hasPrev: false,
      hasNext: false,
    });
  });
});
