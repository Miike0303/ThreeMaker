import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProject } from '../src/load-project.js';

const BOM = '﻿';

const MAP_INFOS_JSON = [null, { id: 1, name: 'Map001', parentId: 0, order: 1 }];
const TILESETS_JSON = [
  null,
  {
    id: 1,
    name: 'Outside',
    tilesetNames: ['Outside_A1', '', '', '', '', '', '', '', ''],
    flags: new Array(8192).fill(0),
  },
];

describe('loadProject — UTF-8 BOM tolerance', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-load-project-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('loads a project whose MapInfos.json and Tilesets.json start with a UTF-8 BOM, instead of throwing on JSON.parse', async () => {
    const dataDir = join(workDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'MapInfos.json'), BOM + JSON.stringify(MAP_INFOS_JSON), 'utf8');
    writeFileSync(join(dataDir, 'Tilesets.json'), BOM + JSON.stringify(TILESETS_JSON), 'utf8');

    const project = await loadProject(workDir);

    expect(project.mapInfos).toHaveLength(1);
    expect(project.mapInfos[0]?.name).toBe('Map001');
    expect(project.tilesets).toHaveLength(1);
    expect(project.tilesets[0]?.name).toBe('Outside');
  });

  it('loads a Map001.json file that starts with a UTF-8 BOM', async () => {
    const dataDir = join(workDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'MapInfos.json'), JSON.stringify(MAP_INFOS_JSON), 'utf8');
    writeFileSync(join(dataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');
    writeFileSync(
      join(dataDir, 'Map001.json'),
      BOM + JSON.stringify({ width: 1, height: 1, tilesetId: 1, data: new Array(6).fill(0) }),
      'utf8',
    );

    const project = await loadProject(workDir);

    expect(project.maps.get(1)?.editorName).toBe('Map001');
  });

  function writeProjectFiles(dataDir: string, mapNames: readonly string[]): void {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'MapInfos.json'), JSON.stringify(MAP_INFOS_JSON), 'utf8');
    writeFileSync(join(dataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');
    const mapJson = JSON.stringify({
      width: 1,
      height: 1,
      tilesetId: 1,
      data: new Array(6).fill(0),
    });
    for (const mapName of mapNames) {
      writeFileSync(join(dataDir, mapName), mapJson, 'utf8');
    }
  }

  it('rejects two map files that resolve to the same numeric id', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map1.json']);

    await expect(loadProject(workDir)).rejects.toThrow(/Duplicate RPG Maker map id 1/);
    await expect(loadProject(workDir)).rejects.toThrow(/Map001\.json/);
    await expect(loadProject(workDir)).rejects.toThrow(/Map1\.json/);
  });

  it('loads Map001.json and Map002.json as distinct maps', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.json']);

    const project = await loadProject(workDir);

    expect(project.maps.size).toBe(2);
    expect(project.maps.get(1)?.editorName).toBe('Map001');
    expect(project.maps.get(1)?.displayName).toBe('');
  });

  it('mutation pin: keeps a one-character editor name on a loaded map', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json']);
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      JSON.stringify([null, { id: 1, name: 'A', parentId: 0, order: 1 }]),
      'utf8',
    );

    const project = await loadProject(workDir);

    expect(project.maps.get(1)?.editorName).toBe('A');
  });

  it('ignores a map filename with a trailing extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json.bak']);

    const project = await loadProject(workDir);

    expect(project.maps.size).toBe(0);
  });

  it('ignores a filename with a prefix before Map001.json', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['BackupMap001.json']);

    const project = await loadProject(workDir);

    expect(project.maps.size).toBe(0);
  });

  it('omits an empty editor name from a loaded map', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json']);
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      JSON.stringify([null, { id: 1, name: '', parentId: 0, order: 1 }]),
      'utf8',
    );

    const project = await loadProject(workDir);

    expect(project.maps.get(1)?.editorName).toBeUndefined();
  });
});

describe('loadProject — data folder layouts', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-load-project-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('finds the data folder of a deployed MV game under <root>/www/data', async () => {
    const dataDir = join(workDir, 'www', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'MapInfos.json'), JSON.stringify(MAP_INFOS_JSON), 'utf8');
    writeFileSync(join(dataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');

    const project = await loadProject(workDir);

    expect(project.mapInfos).toHaveLength(1);
    expect(project.mapInfos[0]?.name).toBe('Map001');
    expect(project.tilesets).toHaveLength(1);
    expect(project.tilesets[0]?.name).toBe('Outside');
  });

  it('skips a data folder with only Tilesets.json when a complete deployed folder exists', async () => {
    const incompleteDataDir = join(workDir, 'data');
    const deployedDataDir = join(workDir, 'www', 'data');
    mkdirSync(incompleteDataDir, { recursive: true });
    mkdirSync(deployedDataDir, { recursive: true });
    writeFileSync(join(incompleteDataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');
    writeFileSync(join(deployedDataDir, 'MapInfos.json'), JSON.stringify(MAP_INFOS_JSON), 'utf8');
    writeFileSync(join(deployedDataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');

    const project = await loadProject(workDir);

    expect(project.mapInfos[0]?.name).toBe('Map001');
  });

  it('prefers <root>/data when both data folder layouts exist', async () => {
    const dataDir = join(workDir, 'data');
    const deployedDataDir = join(workDir, 'www', 'data');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(deployedDataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      JSON.stringify([null, { id: 1, name: 'Project Data', parentId: 0, order: 1 }]),
      'utf8',
    );
    writeFileSync(
      join(deployedDataDir, 'MapInfos.json'),
      JSON.stringify([null, { id: 1, name: 'Deployed Data', parentId: 0, order: 1 }]),
      'utf8',
    );
    writeFileSync(join(dataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');
    writeFileSync(join(deployedDataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');

    const project = await loadProject(workDir);

    expect(project.mapInfos[0]?.name).toBe('Project Data');
  });
});

describe('loadProject — map info order', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-load-project-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns map infos in sidebar tree order', async () => {
    const dataDir = join(workDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      JSON.stringify([
        null,
        { id: 10, name: 'Ten', parentId: 0, order: 1 },
        { id: 11, name: 'Eleven', parentId: 10, order: 0 },
        { id: 12, name: 'Twelve', parentId: 0, order: 0 },
      ]),
      'utf8',
    );
    writeFileSync(join(dataDir, 'Tilesets.json'), JSON.stringify(TILESETS_JSON), 'utf8');

    const project = await loadProject(workDir);

    expect(project.mapInfos.map((info) => info.id)).toEqual([12, 10, 11]);
  });
});
