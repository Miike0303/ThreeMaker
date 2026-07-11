import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MapDocument } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDevExport, sanitizeProjectFolderName } from '../dev-server/export-api.js';

const FLAGS_LENGTH = 8192;

function writeSyntheticTemplate(templateDir: string): void {
  mkdirSync(join(templateDir, 'data'), { recursive: true });
  writeFileSync(join(templateDir, 'index.html'), '<html></html>');
  writeFileSync(join(templateDir, 'data', 'MapInfos.json'), '[null]');
  writeFileSync(join(templateDir, 'data', 'Tilesets.json'), '[null]');
}

function makeDoc(name: string): MapDocument {
  const width = 2;
  const height = 2;
  const size = width * height;
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'demo',
    name,
    width,
    height,
    tileset: { slots: {}, flags: new Array(FLAGS_LENGTH).fill(0), semantics: {} },
    layers: {
      tiles: [
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
      ],
      shadows: new Array(size).fill(0),
      regions: new Array(size).fill(0),
    },
  };
}

describe('sanitizeProjectFolderName', () => {
  it('strips characters unsafe for a folder name, keeping alphanumerics/dash/underscore', () => {
    expect(sanitizeProjectFolderName('My Demo Map!! (v2)')).toBe('My_Demo_Map_v2');
  });

  it('falls back to a safe default when the sanitized result would be empty', () => {
    expect(sanitizeProjectFolderName('???')).toBe('export');
  });
});

describe('runDevExport', () => {
  let workDir: string;
  let templateDir: string;
  let storeDir: string;
  let outBaseDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-dev-export-test-'));
    templateDir = join(workDir, 'template');
    storeDir = join(workDir, 'store');
    outBaseDir = join(workDir, 'exports');
    writeSyntheticTemplate(templateDir);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('creates a fresh, timestamped project folder under outBaseDir named after the sanitized map name', () => {
    const doc = makeDoc('Demo Map');
    const result = runDevExport({ map: doc, templateDir, storeDir, outBaseDir });

    expect(result.outDir.startsWith(join(outBaseDir, 'Demo_Map'))).toBe(true);
    expect(existsSync(join(result.outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(result.outDir, 'game.rmmzproject'))).toBe(true);
  });

  it('detects an installed-engine marker value from engineDir when provided', () => {
    const engineDir = join(workDir, 'engine');
    mkdirSync(join(engineDir, 'dlc', 'Sample Pack', 'proj'), { recursive: true });
    writeFileSync(join(engineDir, 'dlc', 'Sample Pack', 'proj', 'game.rmmzproject'), 'RPGMZ 0.9.5');

    const doc = makeDoc('Detect Marker');
    const result = runDevExport({ map: doc, templateDir, storeDir, outBaseDir, engineDir });

    expect(result.markerValueUsed).toBe('RPGMZ 0.9.5');
    expect(readFileSync(join(result.outDir, 'game.rmmzproject'), 'utf8')).toBe('RPGMZ 0.9.5');
  });

  it('falls back to the empirical marker value when no engineDir is given', () => {
    const doc = makeDoc('No Engine Dir');
    const result = runDevExport({ map: doc, templateDir, storeDir, outBaseDir });
    expect(result.markerValueUsed).toBe('RPGMZ 0.9.4');
  });
});
