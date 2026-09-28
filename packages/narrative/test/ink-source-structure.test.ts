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
  it('recognizes a knot header followed by an author comment', () => {
    expect(listInkKnots('=== opening === // author note\n')).toEqual(['opening']);
  });

  it('deduplicates a repeated knot name across header spacing', () => {
    expect(listInkKnots('=== Start ===\n===Start===\n')).toEqual(['Start']);
  });

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
  it('rejects a layout comment without a Y coordinate', () => {
    expect(parseInkNodeLayouts('// @tm-node opening x=12 y=\n')).toEqual([]);
  });

  it('writes one newline after a layout header when source is empty', () => {
    expect(applyInkNodeLayouts('', [{ knot: 'start', x: 0, y: 0 }])).toBe(
      '// @tm-node start x=0 y=0\n',
    );
  });

  it('preserves the source when there are no layouts to write', () => {
    const source = '=== start ===\nHello.\n';
    expect(applyInkNodeLayouts(source, [])).toBe(source);
  });

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

  it('preserves leading comments in order and is idempotent', () => {
    const source = `// Before layout.
// @tm-node start x=0 y=0
// Keep this note.

// Another note.
=== start ===
Hi`;
    const layouts = [{ knot: 'start', x: 40, y: 60 }];
    const once = applyInkNodeLayouts(source, layouts);
    expect(once).toBe(`// @tm-node start x=40 y=60

// Before layout.
// Keep this note.
// Another note.
=== start ===
Hi`);
    expect(applyInkNodeLayouts(once, layouts)).toBe(once);
  });
});

describe('listInkEdges (lossy visual hops)', () => {
  it('keeps dotted knot names in divert edges', () => {
    expect(listInkEdges('=== start ===\n-> chapter.next\n')).toEqual([
      { from: 'start', to: 'chapter.next' },
    ]);
  });

  it('collects -> target diverts under the current knot', () => {
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
      { from: 'mid', to: 'END' },
    ]);
  });

  it('does not treat [[label|target]] as a divert (not valid ink)', () => {
    const source = `=== start ===
[[Talk|chat]]
`;
    expect(listInkEdges(source)).toEqual([]);
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

  it('ignores // diverts that sit outside quotes', () => {
    const source = '=== start ===\n// -> secret\nHello -> END // -> also\n';
    expect(listInkEdges(source)).toEqual([{ from: 'start', to: 'END' }]);
  });

  it('still follows a divert after a quoted string that contains //', () => {
    const source = '=== start ===\n"see http://x" -> other\n';
    expect(listInkEdges(source)).toEqual([{ from: 'start', to: 'other' }]);
  });

  it('keeps scanning after an escaped quote before // inside a string', () => {
    const source = '=== start ===\n"say \\"// still dialogue" -> target\n';
    expect(listInkEdges(source)).toEqual([{ from: 'start', to: 'target' }]);
  });
});

describe('buildInkGraphModel / setInkNodePosition', () => {
  it('honors zero horizontal spacing in custom grid options', () => {
    const model = buildInkGraphModel('=== first ===\n=== second ===\n', { colWidth: 0 });
    expect(model.nodes[1]).toEqual({ knot: 'second', x: 0, y: 0 });
  });

  it('places the second node at the default column width', () => {
    const model = buildInkGraphModel('=== first ===\n=== second ===\n');

    expect(model.nodes[1]).toEqual({ knot: 'second', x: 180, y: 0 });
  });

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

  it('includes only one graph node for a repeated undeclared divert target', () => {
    const source = `=== a ===
-> END
=== b ===
-> END
`;
    const model = buildInkGraphModel(source);

    expect(model.nodes.map((node) => node.knot)).toEqual(['a', 'b', 'END']);
  });

  it('starts the fifth default graph node on the second row', () => {
    const source = `=== a ===
=== b ===
=== c ===
=== d ===
=== e ===
`;
    const model = buildInkGraphModel(source);

    expect(model.nodes[4]).toEqual({ knot: 'e', x: 0, y: 100 });
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

  it('setInkNodePosition keeps an author note after a layout line exactly once', () => {
    const source = '// @tm-node start x=0 y=0\n// Keep this note.\n=== start ===\nHi';
    const next = setInkNodePosition(source, 'start', 40, 60);
    expect(next).toBe('// @tm-node start x=40 y=60\n\n// Keep this note.\n=== start ===\nHi');
    expect(next.match(/\/\/ Keep this note\./g)).toHaveLength(1);
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

  it('setInkNodePosition records a position for an undeclared knot', () => {
    const source = '=== start ===\nHello.\n';
    const next = setInkNodePosition(source, 'future', 12, 34);

    expect(parseInkNodeLayouts(next)).toContainEqual({ knot: 'future', x: 12, y: 34 });
  });
});

it('collects both conditional divert targets on one line', () => {
  expect(listInkEdges('=== start ===\n{flag: -> left | -> right}\n')).toEqual([
    { from: 'start', to: 'left' },
    { from: 'start', to: 'right' },
  ]);
});

it('honors zero row height for the fifth default graph node', () => {
  const source = '=== a ===\n=== b ===\n=== c ===\n=== d ===\n=== e ===\n';
  const model = buildInkGraphModel(source, { rowHeight: 0 });

  expect(model.nodes[4]).toEqual({ knot: 'e', x: 0, y: 0 });
});

it('keeps underscore-prefixed divert targets', () => {
  expect(listInkEdges('=== start ===\n-> _hidden\n')).toEqual([{ from: 'start', to: '_hidden' }]);
});

it('uses stored layout for a dotted knot name', () => {
  const source = '// @tm-node chapter.next x=17 y=29\n=== chapter.next ===\n';
  const model = buildInkGraphModel(source);

  expect(model.nodes[0]).toEqual({ knot: 'chapter.next', x: 17, y: 29 });
});

it('lists dotted knot names without truncating them', () => {
  expect(listInkKnots('=== chapter.next ===\n')).toEqual(['chapter.next']);
});

it('lists an underscore-prefixed knot name', () => {
  expect(listInkKnots('=== _private ===\n')).toEqual(['_private']);
});

it('parses a layout for an underscore-prefixed knot', () => {
  expect(parseInkNodeLayouts('// @tm-node _private x=3 y=4\n')).toEqual([
    { knot: '_private', x: 3, y: 4 },
  ]);
});

it('recognizes an indented knot header', () => {
  expect(listInkKnots('  === alcove ===\n')).toEqual(['alcove']);
});

it('accepts a fractional horizontal layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node alcove x=-10.5 y=2\n')).toEqual([
    { knot: 'alcove', x: -10.5, y: 2 },
  ]);
});

it('accepts a negative vertical layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node alcove x=4 y=-2.5\n')).toEqual([
    { knot: 'alcove', x: 4, y: -2.5 },
  ]);
});

it('recognizes an indented layout comment', () => {
  expect(parseInkNodeLayouts('  // @tm-node alcove x=4 y=2\n')).toEqual([
    { knot: 'alcove', x: 4, y: 2 },
  ]);
});

it('finds a divert without whitespace after its arrow', () => {
  expect(listInkEdges('=== start ===\n->END\n')).toEqual([{ from: 'start', to: 'END' }]);
});

it('keeps edges from separate knots to the same target', () => {
  expect(listInkEdges('=== start ===\n-> END\n=== retry ===\n-> END\n')).toEqual([
    { from: 'start', to: 'END' },
    { from: 'retry', to: 'END' },
  ]);
});

it('wraps default graph positions at the requested column count', () => {
  const model = buildInkGraphModel('=== first ===\n=== second ===\n=== third ===\n', {
    columns: 2,
  });

  expect(model.nodes[2]).toEqual({ knot: 'third', x: 0, y: 100 });
});

it('uses custom graph spacing when recording a dragged knot', () => {
  const source = '=== first ===\n=== second ===\n';
  const updated = setInkNodePosition(source, 'first', 7, 8, { colWidth: 40 });

  expect(parseInkNodeLayouts(updated)).toContainEqual({ knot: 'second', x: 40, y: 0 });
});

it('keeps the fourth default graph node on the first row', () => {
  const source = '=== first ===\n=== second ===\n=== third ===\n=== fourth ===\n';
  const model = buildInkGraphModel(source);

  expect(model.nodes[3]).toEqual({ knot: 'fourth', x: 540, y: 0 });
});

it('orders undeclared graph nodes by their first divert', () => {
  const model = buildInkGraphModel('=== start ===\n-> first\n-> second\n');

  expect(model.nodes.map((node) => node.knot)).toEqual(['start', 'first', 'second']);
});

it('rejects a layout whose X coordinate overflows to infinity', () => {
  const overflowing = '9'.repeat(309);

  expect(parseInkNodeLayouts(`// @tm-node start x=${overflowing} y=1\n`)).toEqual([]);
});

it('rejects a layout whose Y coordinate overflows to infinity', () => {
  const overflowing = '9'.repeat(309);

  expect(parseInkNodeLayouts(`// @tm-node start x=1 y=${overflowing}\n`)).toEqual([]);
});

it('rejects a layout comment without an X coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node start x= y=1\n')).toEqual([]);
});

it('rejects a layout coordinate with a trailing decimal point', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=1. y=2\n')).toEqual([]);
});

it('requires the exact lowercase layout marker', () => {
  expect(parseInkNodeLayouts('// @TM-NODE start x=1 y=2\n')).toEqual([]);
});
