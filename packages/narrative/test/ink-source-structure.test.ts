/**
 * L4 WU-01: pure knot inventory + layout-comment parse/serialize for the
 * future Ink text↔graph editor. No compile required for structure reads.
 */
import { describe, expect, it } from 'vitest';
import {
  applyInkNodeLayouts,
  buildInkGraphModel,
  type InkNodeLayout,
  listInkEdges,
  listInkKnots,
  parseInkNodeLayouts,
  setInkNodePosition,
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

describe('listInkEdges (lossy visual hops)', () => {
  it('collects -> target and [[label|target]] diverts under the current knot', () => {
    const source = `
=== start ===
Hello
-> mid
* [Go] -> other
[[Talk|chat]]

=== mid ===
-> END

=== other ===
Bye

=== chat ===
Hi
`;
    expect(listInkEdges(source)).toEqual([
      { from: 'start', to: 'mid' },
      { from: 'start', to: 'other' },
      { from: 'start', to: 'chat' },
      { from: 'mid', to: 'END' },
    ]);
  });

  it('dedupes identical from→to pairs and ignores diverts before any knot header', () => {
    const source = `-> nowhere
=== a ===
-> b
-> b
=== b ===
`;
    expect(listInkEdges(source)).toEqual([{ from: 'a', to: 'b' }]);
  });
});

describe('buildInkGraphModel / setInkNodePosition', () => {
  it('merges stored layouts with grid defaults for missing knots', () => {
    const source = `// @tm-node start x=10 y=20
=== start ===
-> mid
=== mid ===
`;
    const model = buildInkGraphModel(source, { colWidth: 180, rowHeight: 100 });
    expect(model.nodes.map((n) => n.knot)).toEqual(['start', 'mid']);
    expect(model.nodes[0]).toEqual({ knot: 'start', x: 10, y: 20 });
    // mid is index 1 → col 1, row 0
    expect(model.nodes[1]).toEqual({ knot: 'mid', x: 180, y: 0 });
    expect(model.edges).toEqual([{ from: 'start', to: 'mid' }]);
  });

  it('includes undeclared divert targets (e.g. END) as graph nodes', () => {
    const source = `=== start ===
-> END
`;
    const model = buildInkGraphModel(source);
    expect(model.nodes.map((n) => n.knot)).toEqual(['start', 'END']);
    expect(model.edges).toEqual([{ from: 'start', to: 'END' }]);
  });

  it('setInkNodePosition rewrites one knot and keeps other layouts', () => {
    const source = `// @tm-node start x=0 y=0
// @tm-node mid x=1 y=1

=== start ===
-> mid
=== mid ===
`;
    const next = setInkNodePosition(source, 'mid', 99, 44);
    expect(parseInkNodeLayouts(next)).toEqual([
      { knot: 'mid', x: 99, y: 44 },
      { knot: 'start', x: 0, y: 0 },
    ]);
    expect(listInkKnots(next)).toEqual(['start', 'mid']);
  });

  it('setInkNodePosition invents defaults for other knots when none stored', () => {
    const source = `=== start ===
-> mid
=== mid ===
`;
    const next = setInkNodePosition(source, 'start', 5, 6);
    const layouts = parseInkNodeLayouts(next);
    expect(layouts.find((l) => l.knot === 'start')).toEqual({ knot: 'start', x: 5, y: 6 });
    expect(layouts.find((l) => l.knot === 'mid')).toBeDefined();
  });
});
