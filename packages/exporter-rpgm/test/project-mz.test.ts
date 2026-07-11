import type { MapDocument } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  buildExportReport,
  buildMapInfosJson,
  buildMapJson,
  buildTilesetsJson,
  sheetFileNameForSlot,
} from '../src/project-mz.js';

const FLAGS_LENGTH = 8192;

function makeDoc(overrides: Partial<MapDocument> = {}): MapDocument {
  const width = 2;
  const height = 2;
  const size = width * height;
  const flags = new Array(FLAGS_LENGTH).fill(0);
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'test-map-id',
    name: 'Test Map',
    width,
    height,
    tileset: {
      slots: {
        A2: { object: 'aaaa1111', sourceTilesetId: 1, sourceGameId: 1 },
        B: { object: 'bbbb2222', sourceTilesetId: 2, sourceGameId: 2 },
      },
      flags,
      semantics: {
        '2816': { class: 'wall' },
      },
    },
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: {
          tiles: [
            new Array(size).fill(2816),
            new Array(size).fill(0),
            new Array(size).fill(5),
            new Array(size).fill(0),
          ],
          shadows: new Array(size).fill(0),
          regions: new Array(size).fill(0),
        },
      },
    ],
    stairLinks: [],
    ...overrides,
  };
}

describe('sheetFileNameForSlot', () => {
  it('is deterministic and collision-safe across different games via the sha256 prefix', () => {
    const nameA = sheetFileNameForSlot('A2', 'aaaa1111bbbb2222cccc3333');
    const nameB = sheetFileNameForSlot('A2', 'ffff9999eeee8888dddd7777');
    expect(nameA).not.toBe(nameB);
    expect(nameA).toBe('A2_aaaa1111bbbb');
  });
});

describe('buildTilesetsJson', () => {
  it('produces the MZ sparse-array shape ([null, entry]) with all 9 sheet slots in A1..E order', () => {
    const doc = makeDoc();
    const sheetFileNames = { A2: 'A2_aaaa1111bbbb.png', B: 'B_bbbb2222cccc.png' };
    const json = buildTilesetsJson(doc, sheetFileNames, 1);

    expect(json).toEqual([
      null,
      {
        id: 1,
        mode: 0,
        name: 'Test Map',
        note: '',
        tilesetNames: ['', 'A2_aaaa1111bbbb.png', '', '', '', 'B_bbbb2222cccc.png', '', '', ''],
        flags: doc.tileset.flags,
      },
    ]);
  });

  it('flags array is passed through unchanged (length 8192, per-slot merged upstream)', () => {
    const doc = makeDoc();
    const json = buildTilesetsJson(doc, {}, 1) as unknown[];
    const entry = json[1] as { flags: number[] };
    expect(entry.flags).toHaveLength(8192);
    expect(entry.flags).toBe(doc.tileset.flags);
  });
});

describe('buildMapInfosJson', () => {
  it('produces the MZ sparse-array shape with a single root-level map entry', () => {
    const json = buildMapInfosJson(1, 'Test Map');
    expect(json).toEqual([
      null,
      { id: 1, expanded: false, name: 'Test Map', order: 1, parentId: 0, scrollX: 0, scrollY: 0 },
    ]);
  });
});

describe('buildMapJson', () => {
  it('round-trips all 4 tile layers + shadows + regions into the flat width*height*6 data array', () => {
    const doc = makeDoc();
    const map = buildMapJson(doc, 1) as { data: number[]; width: number; height: number };

    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.data).toHaveLength(2 * 2 * 6);
    // Layer 0 (bottom tile layer) was filled with 2816 in the fixture.
    expect(map.data.slice(0, 4)).toEqual([2816, 2816, 2816, 2816]);
    // Layer 2 (third tile layer) was filled with 5.
    expect(map.data.slice(8, 12)).toEqual([5, 5, 5, 5]);
  });

  it('includes every MZ-required Map field with safe defaults', () => {
    const doc = makeDoc();
    const map = buildMapJson(doc, 1) as Record<string, unknown>;

    expect(map).toMatchObject({
      autoplayBgm: false,
      autoplayBgs: false,
      battleback1Name: '',
      battleback2Name: '',
      bgm: { name: '', pan: 0, pitch: 100, volume: 90 },
      bgs: { name: '', pan: 0, pitch: 100, volume: 90 },
      disableDashing: false,
      displayName: 'Test Map',
      encounterList: [],
      encounterStep: 30,
      note: '',
      parallaxLoopX: false,
      parallaxLoopY: false,
      parallaxName: '',
      parallaxShow: true,
      parallaxSx: 0,
      parallaxSy: 0,
      scrollType: 0,
      specifyBattleback: false,
      tilesetId: 1,
      events: [],
    });
  });
});

describe('buildExportReport', () => {
  it('reports dropped semantic classes as a manifest note, not silently', () => {
    const doc = makeDoc();
    const report = buildExportReport(doc);
    expect(report.droppedSemanticCount).toBe(1);
    expect(report.notes.some((note) => note.includes('semantic class'))).toBe(true);
  });

  it('reports zero drops when no tile has a non-default semantic class', () => {
    const doc = makeDoc({ tileset: { ...makeDoc().tileset, semantics: {} } });
    const report = buildExportReport(doc);
    expect(report.droppedSemanticCount).toBe(0);
  });

  it('notes which slots were composed from which tilesets (per-slot composition = single RPGM tileset per map)', () => {
    const doc = makeDoc();
    const report = buildExportReport(doc);
    expect(report.composedSlots).toEqual(['A2', 'B']);
  });
});
