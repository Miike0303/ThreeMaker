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

  it('ignores map filenames with whitespace after the numeric ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002 .json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with scientific notation IDs', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map2e2.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with numeric separators in the ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map1_000.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores a map filename with a truncated Map prefix', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Ma002.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores a map filename with no separator before json', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores a map filename with the initial j missing from json', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.son']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('loads a map whose filename has a seven-digit ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map1000000.json']);

    const project = await loadProject(workDir);

    expect(project.maps.get(1000000)?.id).toBe(1000000);
  });

  it('ignores filenames with Max instead of the Map prefix', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Max002.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores filenames with Mop instead of the Map prefix', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Mop002.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with an xson extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.xson']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with a jxon extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.jxon']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with a jsxn extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.jsxn']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with a misspelled JSON extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.jsom']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with an explicit plus sign in the ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map+002.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with a truncated JSON extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.jso']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('rejects a second leading BOM instead of trimming multiple markers', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, []);
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      BOM + BOM + JSON.stringify(MAP_INFOS_JSON),
      'utf8',
    );

    await expect(loadProject(workDir)).rejects.toThrow(SyntaxError);
  });

  it('rejects a leading replacement character instead of stripping it as a BOM', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, []);
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      `\ufffd${JSON.stringify(MAP_INFOS_JSON)}`,
      'utf8',
    );

    await expect(loadProject(workDir)).rejects.toThrow(SyntaxError);
  });

  it('ignores map filenames with fractional IDs', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map001.5.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores map filenames with hexadecimal letters in the ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map00a.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('looks up editor names by map ID when sidebar order differs', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map007.json']);
    writeFileSync(
      join(dataDir, 'MapInfos.json'),
      JSON.stringify([null, { id: 7, name: 'Harbor', parentId: 0, order: 1 }]),
      'utf8',
    );

    const project = await loadProject(workDir);

    expect(project.maps.get(7)?.editorName).toBe('Harbor');
  });

  it('rejects two map files that resolve to the same numeric id', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map1.json']);

    await expect(loadProject(workDir)).rejects.toThrow(/Duplicate RPG Maker map id 1/);
    await expect(loadProject(workDir)).rejects.toThrow(/Map001\.json/);
    await expect(loadProject(workDir)).rejects.toThrow(/Map1\.json/);
  });

  it('rejects duplicate map IDs beyond the first map', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map007.json', 'Map7.json']);

    await expect(loadProject(workDir)).rejects.toThrow(/Duplicate RPG Maker map id 7/);
  });

  it('rejects duplicate map IDs when map 1 is absent', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map007.json', 'Map7.json']);

    await expect(loadProject(workDir)).rejects.toThrow(/Duplicate RPG Maker map id 7/);
  });

  it('loads Map001.json and Map002.json as distinct maps', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.json']);

    const project = await loadProject(workDir);

    expect(project.maps.size).toBe(2);
    expect(project.maps.get(1)?.editorName).toBe('Map001');
    expect(project.maps.get(1)?.displayName).toBe('');
  });

  it('loads a map whose filename has a four-digit id', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map1000.json']);

    const project = await loadProject(workDir);

    expect(project.maps.get(1000)?.id).toBe(1000);
  });

  it('loads a map whose filename has a five-digit ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map10000.json']);

    const project = await loadProject(workDir);

    expect(project.maps.get(10000)?.id).toBe(10000);
  });

  it('loads a map whose filename has a six-digit ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map100000.json']);

    const project = await loadProject(workDir);

    expect(project.maps.get(100000)?.id).toBe(100000);
  });

  it('ignores a map filename with a negative ID', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map-2.json']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
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

  it('ignores a map filename without a literal dot before json', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002xjson']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
  });

  it('ignores lowercase map filenames', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['map001.json']);

    const project = await loadProject(workDir);

    expect(project.maps.size).toBe(0);
  });

  it('ignores map filenames with an uppercase JSON extension', async () => {
    const dataDir = join(workDir, 'data');
    writeProjectFiles(dataDir, ['Map001.json', 'Map002.JSON']);

    const project = await loadProject(workDir);

    expect([...project.maps.keys()]).toEqual([1]);
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

  it('reports the requested root and searched folders when project data is missing', async () => {
    await expect(loadProject(workDir)).rejects.toThrow(
      new Error(
        `Could not find an RPG Maker data folder under "${workDir}" (tried: ${workDir}, ${join(workDir, 'data')}, ${join(workDir, 'www', 'data')}).`,
      ),
    );
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
