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
});
