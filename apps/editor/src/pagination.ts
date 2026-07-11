/**
 * Pure page-range math for the catalog browser's "showing X–Y of Z" label
 * and prev/next button enablement. Extracted so the arithmetic is unit
 * tested independently of the (thin, untested) React component that renders
 * it — see catalog-client.ts's pure/imperative split for the same
 * convention.
 */
export interface PageRange {
  /** 1-indexed first row shown on this page; `0` when `total` is `0`. */
  readonly start: number;
  /** 1-indexed last row shown on this page; `0` when `total` is `0`. */
  readonly end: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

export function computePageRange(page: number, pageSize: number, total: number): PageRange {
  const hasPrev = page > 0;
  if (total <= 0 || pageSize <= 0) {
    return { start: 0, end: 0, hasPrev, hasNext: false };
  }
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return { start, end, hasPrev, hasNext: end < total };
}
