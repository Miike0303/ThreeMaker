import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  RpgmMap,
  RpgmMapInfo,
  RpgmProject,
  RpgmTileset,
  TileSheetNames,
} from '@threemaker/importer-rpgm';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { openCatalog } from '../src/catalog.js';
import { convertRpgmGame, convertSingleRpgmMap } from '../src/convert-rpgm-game.js';

const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

function buildMap(id: number, displayName: string, tilesetId = 1): RpgmMap {
  const width = 3;
  const height = 3;
  const size = width * height;
  const ground = new Array(size).fill(1);
  ground[4] = 2; // center tile: open ground
  return {
    id,
    displayName,
    width,
    height,
    tilesetId,
    scrollType: 0,
    layers: {
      tileLayers: [
        ground,
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
      ],
      shadows: new Array(size).fill(0),
      regions: new Array(size).fill(0),
    },
  };
}

function buildTileset(id = 1): RpgmTileset {
  const flags = new Array(8192).fill(0);
  flags[1] = 0xf; // wall id: impassable in every direction
  return { id, name: 'Outside', sheetNames: EMPTY_SHEET_NAMES, flags };
}

function buildProject(overrides: Partial<RpgmProject> = {}): RpgmProject {
  const mapInfos: RpgmMapInfo[] = [
    { id: 1, name: 'Town', parentId: 0, order: 1 },
    { id: 2, name: 'Dungeon', parentId: 0, order: 2 },
  ];
  const maps = new Map<number, RpgmMap>([
    [1, buildMap(1, 'Town Square')],
    [2, buildMap(2, 'Dungeon Depths')],
  ]);
  return { mapInfos, tilesets: [buildTileset()], maps, ...overrides };
}

describe('convertSingleRpgmMap', () => {
  it('converts one map by id, matching the single-map CLI path', () => {
    const project = buildProject();

    const result = convertSingleRpgmMap(project, 1, '/game');

    expect(result.mapId).toBe(1);
    expect(result.doc.name).toBe('Town Square');
    expect(result.slotsResolved).toBe(0);
    expect(result.isStartMap).toBe(false);
  });

  it('throws when the map id does not exist in the project', () => {
    const project = buildProject();
    expect(() => convertSingleRpgmMap(project, 999, '/game')).toThrow(/no Map999\.json/);
  });

  it('throws when the map references a tilesetId not present in Tilesets.json', () => {
    const project = buildProject({ maps: new Map([[1, buildMap(1, 'Broken', 999)]]) });
    expect(() => convertSingleRpgmMap(project, 1, '/game')).toThrow(/tilesetId 999/);
  });

  it('wires playerStart onto the doc spawn when systemStart.mapId matches this map', () => {
    const project = buildProject();

    const result = convertSingleRpgmMap(project, 1, '/game', {
      systemStart: { mapId: 1, x: 1, y: 1 },
    });

    expect(result.isStartMap).toBe(true);
    expect(result.doc.spawn).toEqual({ x: 1, y: 1, floor: expect.any(String) });
  });

  it('does not apply playerStart to a map that is not the start map', () => {
    const project = buildProject();

    const result = convertSingleRpgmMap(project, 2, '/game', {
      systemStart: { mapId: 1, x: 1, y: 1 },
    });

    expect(result.isStartMap).toBe(false);
  });
});

describe('convertRpgmGame', () => {
  it('converts every map in MapInfos.json order and builds a manifest entry per map', () => {
    const project = buildProject();

    const { converted, failed } = convertRpgmGame(project, '/game');

    expect(failed).toEqual([]);
    expect(converted.map((entry) => entry.mapId)).toEqual([1, 2]);
    expect(converted[0]).toMatchObject({
      mapId: 1,
      name: 'Town Square',
      file: 'map001.tmmap.json',
      slotsResolved: 0,
    });
    expect(converted[1]).toMatchObject({
      mapId: 2,
      name: 'Dungeon Depths',
      file: 'map002.tmmap.json',
      slotsResolved: 0,
    });
  });

  it('appends maps present in `maps` but missing from MapInfos.json, sorted ascending by id, after the known ones', () => {
    const project = buildProject({
      mapInfos: [{ id: 2, name: 'Dungeon', parentId: 0, order: 1 }],
      maps: new Map([
        [2, buildMap(2, 'Dungeon Depths')],
        [5, buildMap(5, 'Secret Room')],
        [3, buildMap(3, 'Hidden Cave')],
      ]),
    });

    const { converted } = convertRpgmGame(project, '/game');

    expect(converted.map((entry) => entry.mapId)).toEqual([2, 3, 5]);
  });

  it('skips a map that fails to convert (fail-soft) and reports it in `failed`, without aborting the rest of the game', () => {
    const project = buildProject({
      maps: new Map([
        [1, buildMap(1, 'Town Square')],
        [2, buildMap(2, 'Broken Map', 999)], // bad tilesetId
        [3, buildMap(3, 'Dungeon Depths')],
      ]),
      mapInfos: [
        { id: 1, name: 'Town', parentId: 0, order: 1 },
        { id: 2, name: 'Broken', parentId: 0, order: 2 },
        { id: 3, name: 'Dungeon', parentId: 0, order: 3 },
      ],
    });

    const { converted, failed } = convertRpgmGame(project, '/game');

    expect(converted.map((entry) => entry.mapId)).toEqual([1, 3]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.mapId).toBe(2);
    expect(failed[0]?.message).toMatch(/tilesetId 999/);
  });

  it('resolves catalog slots per map when a catalog is provided', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'threemaker-convert-rpgm-game-test-'));
    let catalog: Catalog | undefined;
    try {
      catalog = openCatalog(join(workDir, 'catalog.db'));
      const gameId = catalog.upsertGame({
        rootPath: '/game',
        title: 'Test Game',
        engine: 'mz',
        encryptionKey: null,
        scannedAt: new Date().toISOString(),
      });
      const tilesetId = catalog.upsertTileset({
        gameId,
        rpgmId: 1,
        name: 'Outside',
        flags: JSON.stringify(new Array(8192).fill(0)),
      });
      catalog.insertObject({ sha256: 'sha-a1', bytes: 10, kind: 'png' });
      catalog.upsertAsset({
        gameId,
        relPath: 'img/tilesets/Outside_A1.png',
        type: 'tileset',
        sha256: 'sha-a1',
        wasEncrypted: false,
      });
      const asset = catalog.getAssetByRelPath(gameId, 'img/tilesets/Outside_A1.png');
      if (!asset) throw new Error('test setup: asset not found');
      catalog.upsertTilesetSheet({ tilesetId, slot: 'A1', assetId: asset.id });

      const project = buildProject();
      const { converted } = convertRpgmGame(project, '/game', { catalog });

      expect(converted[0]?.slotsResolved).toBe(1);
      expect(converted[1]?.slotsResolved).toBe(1);
    } finally {
      catalog?.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
