/**
 * C5 exit criterion (PLAN_DEV_2 §4) — editor half: ingest a `.glb` the way the
 * place tool does, place a prop with the returned sha, compose the document,
 * and prove the composed `MapDocument` is what the desktop runtime consumes
 * (`prop.object` === ingested sha256) after parse + serialize round-trip.
 *
 * Store-level / seams only (no GUI). Mirrors the desktop headless exit test's
 * fixture (`cube-spin.glb`) so both sides of the authoring → runtime contract
 * share one binary.
 *
 * Neighbours:
 * - `glb-ingest.test.ts` — pure ingest fs contract.
 * - `map-compose-props.test.ts` — compose floor-filter for props.
 * - `painter-store.test.ts` — place/delete/undo prop tool unit coverage.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_MAP_FORMAT_VERSION,
  parseMapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import { describe, expect, it, vi } from 'vitest';
import {
  type GlbIngestFs,
  type IngestGlbDeps,
  ingestGlbBytes,
  objectPathForSha,
} from '../src/glb-ingest.js';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';
import { createPainterState, placeProp, setActivePropObject } from '../src/painter-store.js';

/** Same committed fixture the desktop runtime exit criterion loads. */
const CUBE_SPIN_GLB = new Uint8Array(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../desktop/test/props/cube-spin.glb'),
  ),
);

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'prop-authoring-exit',
  name: 'Prop Authoring Exit Criterion',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

const PROP_X = 1;
const PROP_Y = 2;

function makeFakeFs(): GlbIngestFs & {
  readonly written: Map<string, Uint8Array>;
} {
  const written = new Map<string, Uint8Array>();
  const existing = new Set<string>();
  return {
    written,
    exists: vi.fn(async (path: string) => existing.has(path) || written.has(path)),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      written.set(path, data);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const data = written.get(from);
      if (data) {
        written.delete(from);
        written.set(to, data);
      }
      existing.add(to);
    }),
  };
}

function depsOf(fs: GlbIngestFs): IngestGlbDeps {
  return {
    storeRoot: '/store',
    fs,
    randomSuffix: () => 'exit-criterion',
  };
}

describe('exit criterion: editor prop authoring → composed document sha contract', () => {
  it('ingest → place → compose yields a MapDocument whose prop.object is the ingested sha', async () => {
    const fs = makeFakeFs();
    const { sha256, created } = await ingestGlbBytes(CUBE_SPIN_GLB, depsOf(fs));

    expect(created).toBe(true);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.written.get(objectPathForSha('/store', sha256))).toEqual(CUBE_SPIN_GLB);

    const blank = createBlankMapDocument(BLANK_OPTIONS);
    let state = createPainterState({
      floors: painterFloorsFromDocument(blank),
      width: blank.width,
      height: blank.height,
      props: blank.props,
    });
    state = setActivePropObject(state, sha256);
    state = placeProp(state, { x: PROP_X, y: PROP_Y });

    expect(state.props).toEqual([
      { id: 'prop-1', x: PROP_X, y: PROP_Y, floor: 'floor-0', object: sha256 },
    ]);

    const composed = composeDocumentFromPainterFloors(
      blank,
      state.floors,
      state.rooms,
      state.stairLinks,
      state.spawn,
      state.props,
    );

    const parsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(parsed.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(parsed.props).toHaveLength(1);
    expect(parsed.props[0]?.object).toBe(sha256);
    expect(parsed.props[0]).toEqual({
      id: 'prop-1',
      x: PROP_X,
      y: PROP_Y,
      floor: 'floor-0',
      object: sha256,
    });

    // Round-trip: serialize + parse leaves the prop (and its sha) intact —
    // the exact contract desktop's loadAuthoredMap → buildMapProps consumes.
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(parsed)));
    expect(reparsed.props).toEqual(parsed.props);
    expect(reparsed.props[0]?.object).toBe(sha256);
  });
});
