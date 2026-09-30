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

it('excludes commented-out knot headers from the knot list', () => {
  expect(listInkKnots('// === hidden ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a knot header followed by ordinary prose', () => {
  expect(listInkKnots('=== draft === unfinished dialogue\n=== visible ===\n')).toEqual(['visible']);
});

it('ignores layout markers embedded in dialogue text', () => {
  expect(parseInkNodeLayouts('Narrator: // @tm-node start x=12 y=34\n')).toEqual([]);
});

it('accepts trailing spaces and tabs on a layout comment', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=12 y=34 \t\n')).toEqual([
    { knot: 'start', x: 12, y: 34 },
  ]);
});

it('ignores a commented divert after a string ending in an escaped backslash', () => {
  const source = String.raw`=== start ===
"folder\\" // -> hidden
-> visible
`;

  expect(listInkEdges(source)).toEqual([{ from: 'start', to: 'visible' }]);
});

it('rejects exponent notation in a horizontal layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=1e2 y=3\n')).toEqual([]);
});

it('requires whitespace between the layout marker and knot name', () => {
  expect(parseInkNodeLayouts('// @tm-nodestart x=1 y=2\n')).toEqual([]);
});

it('ignores a knot header without closing equals signs', () => {
  expect(listInkKnots('=== unfinished\n=== finished ===\n')).toEqual(['finished']);
});

it('keeps graph edges distinct when concatenated endpoint names collide', () => {
  const source = '=== a ===\n-> bc\n=== ab ===\n-> c\n';

  expect(listInkEdges(source)).toEqual([
    { from: 'a', to: 'bc' },
    { from: 'ab', to: 'c' },
  ]);
});

it('rejects punctuation as the first character of a knot name', () => {
  expect(listInkKnots('=== [draft ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects punctuation as the first character of a layout knot name', () => {
  expect(parseInkNodeLayouts('// @tm-node [draft x=1 y=2\n')).toEqual([]);
});

it('rejects punctuation as the first character of a divert target', () => {
  expect(listInkEdges('=== start ===\n-> [draft\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('rejects a vertical layout coordinate with a trailing decimal point', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=1 y=2.\n')).toEqual([]);
});

it('ignores a knot header without opening equals signs', () => {
  expect(listInkKnots('unfinished ===\n=== finished ===\n')).toEqual(['finished']);
});

it('keeps digits inside dotted divert target names', () => {
  expect(listInkEdges('=== start ===\n-> chapter2.ending3\n')).toEqual([
    { from: 'start', to: 'chapter2.ending3' },
  ]);
});

it('requires whitespace between the layout knot name and X coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node startx=1 y=2\n')).toEqual([]);
});

it('requires whitespace between layout coordinates', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=1y=2\n')).toEqual([]);
});

it('keeps a divert after a single slash in dialogue', () => {
  expect(listInkEdges('=== start ===\nTake the north / south road. -> END\n')).toEqual([
    { from: 'start', to: 'END' },
  ]);
});

it('recognizes a knot header followed by an empty comment', () => {
  expect(listInkKnots('=== opening === //\n')).toEqual(['opening']);
});

it('rejects exponent notation in a vertical layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node start x=3 y=1e2\n')).toEqual([]);
});

it('replaces stale layouts after an indented author comment', () => {
  const source = '  // Author note.\n// @tm-node start x=0 y=0\n=== start ===\nHello.\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'start', x: 40, y: 60 }])).toBe(
    '// @tm-node start x=40 y=60\n\n  // Author note.\n=== start ===\nHello.\n',
  );
});

it('uses stored positions for knot names containing digits', () => {
  const source = '// @tm-node chapter2.room3 x=17 y=29\n=== chapter2.room3 ===\n';

  expect(buildInkGraphModel(source).nodes).toEqual([{ knot: 'chapter2.room3', x: 17, y: 29 }]);
});

it('rejects knot names that start with a digit', () => {
  expect(listInkKnots('=== 1st_room ===\n=== entry ===\n')).toEqual(['entry']);
});

it('uses stored positions for uppercase knot names', () => {
  const source = '// @tm-node Entry x=17 y=29\n=== Entry ===\n';

  expect(buildInkGraphModel(source).nodes).toEqual([{ knot: 'Entry', x: 17, y: 29 }]);
});

it('parses a layout marker immediately after the comment delimiter', () => {
  expect(parseInkNodeLayouts('//@tm-node entry x=4 y=7\n')).toEqual([
    { knot: 'entry', x: 4, y: 7 },
  ]);
});

it('uses stored positions for knot names with internal underscores', () => {
  const source = '// @tm-node chapter_entry x=17 y=29\n=== chapter_entry ===\n';

  expect(buildInkGraphModel(source).nodes).toEqual([{ knot: 'chapter_entry', x: 17, y: 29 }]);
});

it('rejects layout knot names that start with a digit', () => {
  expect(parseInkNodeLayouts('// @tm-node 2room x=17 y=29\n')).toEqual([]);
});

it('rejects divert targets that start with a digit', () => {
  expect(listInkEdges('=== start ===\n-> 2room\n-> room2\n')).toEqual([
    { from: 'start', to: 'room2' },
  ]);
});

it('keeps internal underscores in divert target names', () => {
  expect(listInkEdges('=== start ===\n-> side_room\n')).toEqual([
    { from: 'start', to: 'side_room' },
  ]);
});

it('preserves multiple fractional digits in a horizontal layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=12.25 y=4\n')).toEqual([
    { knot: 'entry', x: 12.25, y: 4 },
  ]);
});

it('preserves multiple fractional digits in a vertical layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=4 y=-12.25\n')).toEqual([
    { knot: 'entry', x: 4, y: -12.25 },
  ]);
});

it('finds a divert after multiple whitespace characters', () => {
  expect(listInkEdges('=== start ===\n-> \t next\n')).toEqual([{ from: 'start', to: 'next' }]);
});

it('parses layout markers with multiple whitespace characters before the knot', () => {
  expect(parseInkNodeLayouts('// @tm-node \t entry x=4 y=7\n')).toEqual([
    { knot: 'entry', x: 4, y: 7 },
  ]);
});

it('rejects a single slash as a knot header comment delimiter', () => {
  expect(listInkKnots('=== hidden === / author note\n=== visible ===\n')).toEqual(['visible']);
});

it('normalizes CRLF in the preserved body when rewriting layouts', () => {
  const source = '// @tm-node entry x=0 y=0\r\n// Author note.\r\n=== entry ===\r\nWelcome.\r\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'entry', x: 17, y: 29 }])).toBe(
    '// @tm-node entry x=17 y=29\n\n// Author note.\n=== entry ===\nWelcome.\n',
  );
});

it('rejects a knot header with a hyphen inside its name', () => {
  expect(listInkKnots('=== side-room ===\n=== entry ===\n')).toEqual(['entry']);
});

it('rejects a layout knot name containing a hyphen', () => {
  expect(parseInkNodeLayouts('// @tm-node side-room x=4 y=7\n')).toEqual([]);
});

it('parses a layout marker after multiple comment-padding characters', () => {
  expect(parseInkNodeLayouts('// \t @tm-node entry x=4 y=7\n')).toEqual([
    { knot: 'entry', x: 4, y: 7 },
  ]);
});

it('parses an X coordinate after multiple separating whitespace characters', () => {
  expect(parseInkNodeLayouts('// @tm-node entry \t x=4 y=7\n')).toEqual([
    { knot: 'entry', x: 4, y: 7 },
  ]);
});

it('parses a Y coordinate after multiple separating whitespace characters', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=4 \t y=7\n')).toEqual([
    { knot: 'entry', x: 4, y: 7 },
  ]);
});

it('recognizes a knot header with multiple spaces before its author comment', () => {
  expect(listInkKnots('=== entry === \t // Author note.\n')).toEqual(['entry']);
});

it('preserves the story body after a line with an inline comment', () => {
  const source =
    'Opening. // Keep this inline note.\n\n// @tm-node start x=1 y=2\n=== start ===\nWelcome.\n';
  expect(applyInkNodeLayouts(source, [{ knot: 'start', x: 17, y: 29 }])).toBe(
    `// @tm-node start x=17 y=29\n\n${source}`,
  );
});

it('recognizes a knot header indented with a tab', () => {
  expect(listInkKnots('\t=== entry ===\n')).toEqual(['entry']);
});

it('recognizes a layout comment indented with a tab', () => {
  expect(parseInkNodeLayouts('\t// @tm-node entry x=17 y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('recognizes a tab between the opening header delimiter and knot name', () => {
  expect(listInkKnots('===\tentry ===\n')).toEqual(['entry']);
});

it('keeps an unquoted backslash from escaping a following comment delimiter', () => {
  const source = '=== start ===\nPath \\// -> hidden\n-> visible\n';

  expect(listInkEdges(source)).toEqual([{ from: 'start', to: 'visible' }]);
});

it('rejects a leading plus sign on a horizontal layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=+4 y=7\n')).toEqual([]);
});

it('rejects a leading plus sign on a vertical layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=4 y=+7\n')).toEqual([]);
});

it('recognizes a tab before the closing knot delimiter', () => {
  expect(listInkKnots('=== entry\t===\n')).toEqual(['entry']);
});

it('rejects a layout marker with only one comment slash', () => {
  expect(parseInkNodeLayouts('/ @tm-node entry x=17 y=29\n')).toEqual([]);
});

it('preserves an author comment without the layout marker sigil', () => {
  const source = '// tm-node entry x=1 y=2\n=== entry ===\nWelcome.\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'entry', x: 17, y: 29 }])).toBe(
    `// @tm-node entry x=17 y=29\n\n${source}`,
  );
});

it('does not turn a greater-than sign in dialogue into a divert', () => {
  expect(listInkEdges('=== start ===\nBetter > worse.\n-> exit\n')).toEqual([
    { from: 'start', to: 'exit' },
  ]);
});

it('deduplicates a knot name after multiple repeated headers', () => {
  expect(listInkKnots('=== start ===\n===start===\n=== start ===\n')).toEqual(['start']);
});

it('keeps one graph edge after three identical diverts', () => {
  expect(listInkEdges('=== start ===\n-> exit\n-> exit\n-> exit\n')).toEqual([
    { from: 'start', to: 'exit' },
  ]);
});

it('lists knot names with internal uppercase letters', () => {
  expect(listInkKnots('=== sideRoom ===\n')).toEqual(['sideRoom']);
});

it('reads a stored layout for a knot with internal uppercase letters', () => {
  expect(parseInkNodeLayouts('// @tm-node sideRoom x=17 y=29\n')).toEqual([
    { knot: 'sideRoom', x: 17, y: 29 },
  ]);
});

it('keeps a column-zero divert before an inline comment', () => {
  expect(listInkEdges('=== start ===\n-> exit // -> hidden\n')).toEqual([
    { from: 'start', to: 'exit' },
  ]);
});

it('includes Z at the uppercase knot name boundary', () => {
  expect(listInkKnots('=== Zone ===\n')).toEqual(['Zone']);
});

it('restores a stored layout at the uppercase knot name boundary', () => {
  const source = '// @tm-node Zone x=17 y=29\n=== Zone ===\n';

  expect(buildInkGraphModel(source).nodes).toEqual([{ knot: 'Zone', x: 17, y: 29 }]);
});

it('lists a knot beginning with lowercase z', () => {
  expect(listInkKnots('=== zone ===\n')).toEqual(['zone']);
});

it('reads a stored layout for a knot beginning with lowercase z', () => {
  expect(parseInkNodeLayouts('// @tm-node zone x=17 y=29\n')).toEqual([
    { knot: 'zone', x: 17, y: 29 },
  ]);
});

it('keeps a divert target beginning with lowercase z', () => {
  expect(listInkEdges('=== start ===\n-> zone\n')).toEqual([{ from: 'start', to: 'zone' }]);
});

it('keeps a divert target beginning with uppercase Z', () => {
  expect(listInkEdges('=== start ===\n-> Zone\n')).toEqual([{ from: 'start', to: 'Zone' }]);
});

it('lists a knot beginning with uppercase A', () => {
  expect(listInkKnots('=== Atrium ===\n')).toEqual(['Atrium']);
});

it('reads a stored layout for a knot beginning with uppercase A', () => {
  expect(parseInkNodeLayouts('// @tm-node Atrium x=17 y=29\n')).toEqual([
    { knot: 'Atrium', x: 17, y: 29 },
  ]);
});

it('keeps a divert target beginning with uppercase A', () => {
  expect(listInkEdges('=== start ===\n-> Atrium\n')).toEqual([{ from: 'start', to: 'Atrium' }]);
});

it('records an undeclared knot that sorts after existing knots', () => {
  const source = '// @tm-node start x=3 y=5\n=== start ===\nHello.\n';

  const updated = setInkNodePosition(source, 'zeta', 12, 34);

  expect(parseInkNodeLayouts(updated)).toEqual([
    { knot: 'start', x: 3, y: 5 },
    { knot: 'zeta', x: 12, y: 34 },
  ]);
});

it('recognizes a knot header indented with a non-breaking space', () => {
  expect(listInkKnots('\u00a0=== entry ===\n')).toEqual(['entry']);
});

it('recognizes a layout comment indented with a non-breaking space', () => {
  expect(parseInkNodeLayouts('\u00a0// @tm-node entry x=17 y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('finds a divert after a non-breaking space', () => {
  expect(listInkEdges('=== start ===\n->\u00a0exit\n')).toEqual([{ from: 'start', to: 'exit' }]);
});

it('rejects a knot name that begins with a dot', () => {
  expect(listInkKnots('=== .hidden ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a layout knot name that begins with a dot', () => {
  expect(parseInkNodeLayouts('// @tm-node .hidden x=17 y=29\n')).toEqual([]);
});

it('ignores a divert target that begins with a dot', () => {
  expect(listInkEdges('=== start ===\n-> .hidden\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('lists knot names containing a zero digit', () => {
  expect(listInkKnots('=== room0 ===\n')).toEqual(['room0']);
});

it('reads a stored layout for a knot containing a zero digit', () => {
  expect(parseInkNodeLayouts('// @tm-node room0 x=17 y=29\n')).toEqual([
    { knot: 'room0', x: 17, y: 29 },
  ]);
});

it('keeps a zero digit inside a divert target name', () => {
  expect(listInkEdges('=== start ===\n-> room0\n')).toEqual([{ from: 'start', to: 'room0' }]);
});

it('ignores a separated arrow in dialogue text', () => {
  expect(listInkEdges('=== start ===\nThe sign reads - > exit.\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('keeps a divert after a slash directly followed by a word', () => {
  expect(listInkEdges('=== start ===\nTake /north -> exit\n')).toEqual([
    { from: 'start', to: 'exit' },
  ]);
});

it('recognizes a non-breaking space after the opening knot delimiter', () => {
  expect(listInkKnots('===\u00a0entry ===\n')).toEqual(['entry']);
});

it('recognizes a non-breaking space before the closing knot delimiter', () => {
  expect(listInkKnots('=== entry\u00a0===\n')).toEqual(['entry']);
});

it('recognizes a non-breaking space before a knot header comment', () => {
  expect(listInkKnots('=== entry ===\u00a0// Author note.\n')).toEqual(['entry']);
});

it('reads a non-breaking space after the layout marker', () => {
  expect(parseInkNodeLayouts('// @tm-node\u00a0entry x=17 y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('reads a non-breaking space before the horizontal layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry\u00a0x=17 y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('reads a non-breaking space before the vertical layout coordinate', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=17\u00a0y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('reads a layout comment with a trailing non-breaking space', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=17 y=29\u00a0\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('rejects a knot name that begins with a hyphen', () => {
  expect(listInkKnots('=== -draft ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a layout knot name that begins with a hyphen', () => {
  expect(parseInkNodeLayouts('// @tm-node -draft x=17 y=29\n')).toEqual([]);
});

it('ignores a divert target that begins with a hyphen', () => {
  expect(listInkEdges('=== start ===\n-> -draft\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('lists a knot name containing a nine digit', () => {
  expect(listInkKnots('=== room9 ===\n')).toEqual(['room9']);
});

it('reads a stored layout for a knot containing a nine digit', () => {
  expect(parseInkNodeLayouts('// @tm-node room9 x=17 y=29\n')).toEqual([
    { knot: 'room9', x: 17, y: 29 },
  ]);
});

it('keeps a nine digit inside a divert target name', () => {
  expect(listInkEdges('=== start ===\n-> room9\n')).toEqual([{ from: 'start', to: 'room9' }]);
});

it('reads a horizontal layout coordinate with four integer digits', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=1024 y=29\n')).toEqual([
    { knot: 'entry', x: 1024, y: 29 },
  ]);
});

it('reads a vertical layout coordinate with four integer digits', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=17 y=1024\n')).toEqual([
    { knot: 'entry', x: 17, y: 1024 },
  ]);
});

it('rejects a knot name that begins with a dollar sign', () => {
  expect(listInkKnots('=== $draft ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a layout knot name that begins with a dollar sign', () => {
  expect(parseInkNodeLayouts('// @tm-node $draft x=17 y=29\n')).toEqual([]);
});

it('ignores a divert target that begins with a dollar sign', () => {
  expect(listInkEdges('=== start ===\n-> $draft\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('rejects a knot name containing a dollar sign', () => {
  expect(listInkKnots('=== side$room ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a layout knot name containing a dollar sign', () => {
  expect(parseInkNodeLayouts('// @tm-node side$room x=17 y=29\n')).toEqual([]);
});

it('stops a divert target name at a dollar sign', () => {
  expect(listInkEdges('=== start ===\n-> side$room\n')).toEqual([{ from: 'start', to: 'side' }]);
});

it('ignores a fat arrow in dialogue text', () => {
  expect(listInkEdges('=== start ===\nThe sign reads => exit.\n-> visible\n')).toEqual([
    { from: 'start', to: 'visible' },
  ]);
});

it('preserves a triple-slash author comment when rewriting layouts', () => {
  const source = '/// @tm-node draft x=1 y=2\n=== start ===\nWelcome.\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'start', x: 17, y: 29 }])).toBe(
    `// @tm-node start x=17 y=29\n\n${source}`,
  );
});

it('rejects a bracket inside a knot name', () => {
  expect(listInkKnots('=== side[room ===\n=== visible ===\n')).toEqual(['visible']);
});

it('rejects a bracket inside a stored layout knot name', () => {
  expect(parseInkNodeLayouts('// @tm-node side[room x=17 y=29\n')).toEqual([]);
});

it('stops a divert target name at a bracket', () => {
  expect(listInkEdges('=== start ===\n-> side[room\n')).toEqual([{ from: 'start', to: 'side' }]);
});

it('reads a layout marker after non-breaking comment padding', () => {
  expect(parseInkNodeLayouts('//\u00a0@tm-node entry x=17 y=29\n')).toEqual([
    { knot: 'entry', x: 17, y: 29 },
  ]);
});

it('recognizes a knot header with four opening equals signs', () => {
  expect(listInkKnots('==== entry ===\n')).toEqual(['entry']);
});

it('stops a divert target name at an internal hyphen', () => {
  expect(listInkEdges('=== start ===\n-> side-room\n')).toEqual([{ from: 'start', to: 'side' }]);
});

it('recognizes a knot header with four closing equals signs', () => {
  expect(listInkKnots('=== entry ====\n')).toEqual(['entry']);
});

it('rejects a layout marker with an underscore instead of a hyphen', () => {
  expect(parseInkNodeLayouts('// @tm_node entry x=17 y=29\n')).toEqual([]);
});

it('rejects a layout coordinate with no horizontal key', () => {
  expect(parseInkNodeLayouts('// @tm-node entry =17 y=29\n')).toEqual([]);
});

it('rejects a layout coordinate with no vertical key', () => {
  expect(parseInkNodeLayouts('// @tm-node entry x=17 =29\n')).toEqual([]);
});

it('recognizes a knot header followed by a comment containing a URL', () => {
  expect(listInkKnots('=== entry === // https://example.invalid/story\n')).toEqual(['entry']);
});

it('preserves a content carriage return before CRLF when rewriting layouts', () => {
  const source = '=== entry ===\r\nWait.\r\r\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'entry', x: 17, y: 29 }])).toBe(
    '// @tm-node entry x=17 y=29\n\n=== entry ===\nWait.\r\n',
  );
});

it('rejects a colon inside a knot header name', () => {
  expect(listInkKnots('=== chapter:ending ===\n=== entry ===\n')).toEqual(['entry']);
});

it('rejects a colon inside a stored layout knot name', () => {
  expect(parseInkNodeLayouts('// @tm-node chapter:ending x=17 y=29\n')).toEqual([]);
});

it('stops a divert target name at a colon', () => {
  expect(listInkEdges('=== start ===\n-> chapter:ending\n')).toEqual([
    { from: 'start', to: 'chapter' },
  ]);
});

it('rewrites a leading layout block after a whitespace-only line', () => {
  const source = ' \t \n// @tm-node entry x=0 y=0\n=== entry ===\nWelcome.\n';

  expect(applyInkNodeLayouts(source, [{ knot: 'entry', x: 17, y: 29 }])).toBe(
    '// @tm-node entry x=17 y=29\n\n=== entry ===\nWelcome.\n',
  );
});
