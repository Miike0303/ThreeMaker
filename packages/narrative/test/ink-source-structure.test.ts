/**
 * L4 WU-01: pure knot inventory + layout-comment parse/serialize for the
 * future Ink text↔graph editor. No compile required for structure reads.
 */
import { describe, expect, it } from 'vitest';
import {
  applyInkNodeLayouts,
  type InkNodeLayout,
  listInkKnots,
  parseInkNodeLayouts,
} from '../src/ink-source-structure.js';

describe('listInkKnots', () => {
  it('returns empty for blank / knot-less source', () => {
    expect(listInkKnots('')).toEqual([]);
    expect(listInkKnots('Hello world\n')).toEqual([]);
    expect(listInkKnots('// just a comment\n* choice\n')).toEqual([]);
  });

  it('lists === knot === and = stitch = names in source order (unique)', () => {
    const source = `
=== start ===
Hello
-> mid

=== mid ===
// stitch under mid
= detail =
More
-> END

=== end_room ===
Bye
`;
    expect(listInkKnots(source)).toEqual(['start', 'mid', 'detail', 'end_room']);
  });

  it('ignores non-header equals noise and trims names', () => {
    expect(listInkKnots('===  greeter  ===\nx = 1\n===other===\n')).toEqual(['greeter', 'other']);
  });
});

describe('parseInkNodeLayouts / applyInkNodeLayouts', () => {
  it('parses // @tm-node <knot> x=<n> y=<n> lines', () => {
    const source = `// @tm-node start x=120 y=40
// @tm-node mid x=-10 y=200.5
// noise
=== start ===
hi
`;
    expect(parseInkNodeLayouts(source)).toEqual([
      { knot: 'start', x: 120, y: 40 },
      { knot: 'mid', x: -10, y: 200.5 },
    ]);
  });

  it('ignores malformed layout comments', () => {
    const source = `// @tm-node
// @tm-node onlyname
// @tm-node k x=nope y=1
// @tm-node k x=1 y=2 extra
// @tm-node k x=1 y=2
=== k ===
`;
    expect(parseInkNodeLayouts(source)).toEqual([{ knot: 'k', x: 1, y: 2 }]);
  });

  it('apply rewrites the layout block at the top, preserves body, stable knot sort', () => {
    const source = `// @tm-node mid x=0 y=0
// @tm-node start x=1 y=1

=== start ===
A

=== mid ===
B
`;
    const layouts: readonly InkNodeLayout[] = [
      { knot: 'mid', x: 50, y: 60 },
      { knot: 'start', x: 10, y: 20 },
    ];
    const next = applyInkNodeLayouts(source, layouts);
    expect(next.startsWith('// @tm-node mid x=50 y=60\n// @tm-node start x=10 y=20\n')).toBe(true);
    expect(next).toContain('=== start ===');
    expect(next).toContain('=== mid ===');
    expect(next).not.toContain('x=0 y=0');
    expect(parseInkNodeLayouts(next)).toEqual([
      { knot: 'mid', x: 50, y: 60 },
      { knot: 'start', x: 10, y: 20 },
    ]);
  });

  it('apply on source with no prior layout block only prepends comments', () => {
    const body = '=== start ===\nHi\n';
    const next = applyInkNodeLayouts(body, [{ knot: 'start', x: 0, y: 0 }]);
    expect(next).toBe('// @tm-node start x=0 y=0\n\n=== start ===\nHi\n');
  });
});
