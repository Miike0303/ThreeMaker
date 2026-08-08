/**
 * Pure structure helpers for the Ink text↔graph editor (L4 WU-01 / WU-03).
 *
 * Text remains the source of truth. Layout is stored as special comments so
 * a single `.ink` sidecar carries both dialogue and node positions — no
 * second metadata file. Edges are best-effort (visual aid only).
 */

/** One knot/stitch name with canvas position (editor graph). */
export type InkNodeLayout = {
  readonly knot: string;
  readonly x: number;
  readonly y: number;
};

/** Best-effort divert hop for the graph view (lossy). */
export type InkEdge = {
  readonly from: string;
  readonly to: string;
};

/** Graph snapshot for the editor: nodes (with positions) + edges. */
export type InkGraphModel = {
  readonly nodes: readonly InkNodeLayout[];
  readonly edges: readonly InkEdge[];
};

export type BuildInkGraphModelOptions = {
  /** Horizontal spacing for missing layout defaults (default 180). */
  readonly colWidth?: number;
  /** Vertical spacing for missing layout defaults (default 100). */
  readonly rowHeight?: number;
  /** How many columns in the default grid (default 4). */
  readonly columns?: number;
};

/** `=== name ===` (knot) or `= name =` (stitch) header line. */
const KNOT_HEADER = /^\s*(?:=+)\s*([A-Za-z_][\w.]*)\s*(?:=+)\s*(?:\/\/.*)?$/;

/** `// @tm-node <knot> x=<number> y=<number>` layout comment. */
const LAYOUT_LINE =
  /^\s*\/\/\s*@tm-node\s+([A-Za-z_][\w.]*)\s+x=(-?\d+(?:\.\d+)?)\s+y=(-?\d+(?:\.\d+)?)\s*$/;

/** `-> target` divert (arrow form). */
const ARROW_DIVERT = /->\s*([A-Za-z_][\w.]*)/g;

/** `[[label|target]]` choice divert. */
const BRACKET_DIVERT = /\[\[[^\]]*\|([A-Za-z_][\w.]*)\]\]/g;
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

/**
 * Best-effort divert edges for the graph (visual aid). Text remains truth —
 * missing/extra edges are OK. Diverts before the first knot header are ignored.
 * Includes hops to `END` and to knots not declared in this file.
 */
export function listInkEdges(source: string): readonly InkEdge[] {
  const edges: InkEdge[] = [];
  const seen = new Set<string>();
  let current: string | null = null;

  for (const line of source.split(/\r?\n/)) {
    const header = KNOT_HEADER.exec(line);
    if (header?.[1]) {
      current = header[1];
      continue;
    }
    if (current === null) continue;

    for (const re of [ARROW_DIVERT, BRACKET_DIVERT]) {
      re.lastIndex = 0;
      let match = re.exec(line);
      while (match) {
        const to = match[1];
        if (to) {
          const key = `${current}\0${to}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({ from: current, to });
          }
        }
        match = re.exec(line);
      }
    }
  }
  return edges;
}

function defaultGridPosition(
  index: number,
  colWidth: number,
  rowHeight: number,
  columns: number,
): { readonly x: number; readonly y: number } {
  const col = index % columns;
  const row = Math.floor(index / columns);
  return { x: col * colWidth, y: row * rowHeight };
}

/**
 * Builds the editor graph model: one node per listed knot/stitch (stored
 * `@tm-node` position when present, else a stable grid default) plus edges.
 */
export function buildInkGraphModel(
  source: string,
  options: BuildInkGraphModelOptions = {},
): InkGraphModel {
  const colWidth = options.colWidth ?? 180;
  const rowHeight = options.rowHeight ?? 100;
  const columns = options.columns ?? 4;
  const knots = listInkKnots(source);
  const edges = listInkEdges(source);
  // Divert targets that are not declared knots (e.g. END, external) still get a node.
  const declared = new Set(knots);
  const extras: string[] = [];
  for (const edge of edges) {
    if (!declared.has(edge.to) && !extras.includes(edge.to)) extras.push(edge.to);
  }
  const allKnots = [...knots, ...extras];
  const stored = new Map(parseInkNodeLayouts(source).map((n) => [n.knot, n] as const));
  const nodes: InkNodeLayout[] = allKnots.map((knot, index) => {
    const existing = stored.get(knot);
    if (existing) return existing;
    const pos = defaultGridPosition(index, colWidth, rowHeight, columns);
    return { knot, x: pos.x, y: pos.y };
  });
  return { nodes, edges };
}

/**
 * Moves one knot on the graph and rewrites the layout preamble. Other knots
 * keep stored positions when present; otherwise they receive grid defaults so
 * a single drag still produces a complete layout block.
 */
export function setInkNodePosition(
  source: string,
  knot: string,
  x: number,
  y: number,
  options: BuildInkGraphModelOptions = {},
): string {
  const model = buildInkGraphModel(source, options);
  const layouts = model.nodes.map((node) => (node.knot === knot ? { knot, x, y } : node));
  // If the knot is not in the source yet, still record the position.
  if (!layouts.some((n) => n.knot === knot)) {
    layouts.push({ knot, x, y });
  }
  return applyInkNodeLayouts(source, layouts);
}
