/**
 * Pure structure helpers for the Ink text↔graph editor (L4 WU-01).
 *
 * Text remains the source of truth. Layout is stored as special comments so
 * a single `.ink` sidecar carries both dialogue and node positions — no
 * second metadata file. Graph edges are not inferred here (editor UI WU-03).
 */

/** One knot/stitch name with canvas position (editor graph). */
export type InkNodeLayout = {
  readonly knot: string;
  readonly x: number;
  readonly y: number;
};

/** `=== name ===` (knot) or `= name =` (stitch) header line. */
const KNOT_HEADER = /^\s*(?:=+)\s*([A-Za-z_][\w.]*)\s*(?:=+)\s*(?:\/\/.*)?$/;

/** `// @tm-node <knot> x=<number> y=<number>` layout comment. */
const LAYOUT_LINE =
  /^\s*\/\/\s*@tm-node\s+([A-Za-z_][\w.]*)\s+x=(-?\d+(?:\.\d+)?)\s+y=(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Lists knot and stitch names from ink source in first-seen order.
 * Does not compile — works on incomplete drafts so the graph can still open.
 */
export function listInkKnots(source: string): readonly string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = KNOT_HEADER.exec(line);
    if (!match) continue;
    const name = match[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Reads every well-formed `@tm-node` layout comment (source order). */
export function parseInkNodeLayouts(source: string): readonly InkNodeLayout[] {
  const layouts: InkNodeLayout[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = LAYOUT_LINE.exec(line);
    if (!match) continue;
    const knot = match[1];
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (!knot || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    layouts.push({ knot, x, y });
  }
  return layouts;
}

/**
 * Replaces the leading layout-comment block with a stable-sorted write of
 * `layouts`, preserving the remaining source body. Non-layout leading
 * comments that sit inside the old layout region are dropped (layout owns
 * the preamble); body after the first non-layout content is kept.
 */
export function applyInkNodeLayouts(source: string, layouts: readonly InkNodeLayout[]): string {
  const body = stripLeadingLayoutBlock(source);
  const sorted = [...layouts].sort((a, b) => a.knot.localeCompare(b.knot));
  const header = sorted
    .map((node) => `// @tm-node ${node.knot} x=${formatCoord(node.x)} y=${formatCoord(node.y)}`)
    .join('\n');
  if (header.length === 0) return body;
  if (body.length === 0) return `${header}\n`;
  return `${header}\n\n${body}`;
}

function formatCoord(n: number): string {
  // Prefer compact ints when exact; otherwise plain number string.
  return Number.isInteger(n) ? String(n) : String(n);
}

/**
 * Drop a leading run of blank lines and `@tm-node` comments (and any other
 * full-line `//` comments that appear before the first non-comment content,
 * only while we are still in the preamble). Once a non-comment line appears,
 * the rest is body — including later layout comments (treated as body noise).
 */
function stripLeadingLayoutBlock(source: string): string {
  const lines = source.split(/\r?\n/);
  let i = 0;
  let sawLayout = false;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      i += 1;
      continue;
    }
    if (LAYOUT_LINE.test(line)) {
      sawLayout = true;
      i += 1;
      continue;
    }
    // Other // comments only strip when we already saw a layout line in this
    // preamble (so a pure story with author comments at the top is preserved).
    if (sawLayout && trimmed.startsWith('//')) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}
