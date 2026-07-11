import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMapFile, saveMapFile } from '../dev-server/map-api.js';

describe('map-api (dev-only map persistence)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-map-api-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('loadMapFile returns null when nothing has been saved yet', () => {
    const path = join(workDir, 'nested', 'editor-map.tmmap.json');
    expect(loadMapFile(path)).toBeNull();
  });

  it('saveMapFile creates parent directories and writes the JSON text, readable back via loadMapFile', () => {
    const path = join(workDir, 'nested', 'editor-map.tmmap.json');
    const json = JSON.stringify({ format: 'threemaker-map', version: 1 });

    saveMapFile(path, json);

    expect(loadMapFile(path)).toBe(json);
  });

  it('saveMapFile overwrites a previous save', () => {
    const path = join(workDir, 'editor-map.tmmap.json');
    saveMapFile(path, '{"a":1}');
    saveMapFile(path, '{"a":2}');
    expect(loadMapFile(path)).toBe('{"a":2}');
  });
});
