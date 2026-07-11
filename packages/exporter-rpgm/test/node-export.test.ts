import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MapDocument } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportError, findInstalledMarkerVersion, runExport } from '../src/node.js';

const FLAGS_LENGTH = 8192;

function makePng(seed: string): Buffer {
  // Real PNG magic + arbitrary seeded bytes -- good enough for a byte-identity copy check.
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(seed)]);
}

function storeObjectFor(storeDir: string, bytes: Buffer): string {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = join(storeDir, 'objects', sha256.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sha256), bytes);
  return sha256;
}

/** A minimal, synthetic stand-in for the real MZ blank template -- deliberately NOT a copy of any real installed engine file (see apply-progress's "nothing from C:\Games\RPG Maker MZ gets committed" convention). Only exercises the copy-whole-template-then-overwrite-data behavior. */
function writeSyntheticTemplate(templateDir: string): void {
  mkdirSync(join(templateDir, 'data'), { recursive: true });
  mkdirSync(join(templateDir, 'img', 'tilesets'), { recursive: true });
  mkdirSync(join(templateDir, 'js'), { recursive: true });
  writeFileSync(join(templateDir, 'index.html'), '<html></html>');
  writeFileSync(join(templateDir, 'js', 'main.js'), '// synthetic template main.js');
  writeFileSync(join(templateDir, 'data', 'System.json'), '{"placeholder":true}');
  // Template ships blank/placeholder data files -- export must OVERWRITE these.
  writeFileSync(join(templateDir, 'data', 'MapInfos.json'), '[null]');
  writeFileSync(join(templateDir, 'data', 'Tilesets.json'), '[null]');
}

function makeDoc(slots: MapDocument['tileset']['slots']): MapDocument {
  const width = 2;
  const height = 2;
  const size = width * height;
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'demo',
    name: 'Demo Map',
    width,
    height,
    tileset: { slots, flags: new Array(FLAGS_LENGTH).fill(0), semantics: {} },
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: {
          tiles: [
            new Array(size).fill(2816),
            new Array(size).fill(0),
            new Array(size).fill(0),
            new Array(size).fill(0),
          ],
          shadows: new Array(size).fill(0),
          regions: new Array(size).fill(0),
        },
      },
    ],
    stairLinks: [],
  };
}

describe('runExport (node fs execution)', () => {
  let workDir: string;
  let templateDir: string;
  let storeDir: string;
  let outDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-exporter-test-'));
    templateDir = join(workDir, 'template');
    storeDir = join(workDir, 'store');
    outDir = join(workDir, 'out', 'MyExportedProject');
    writeSyntheticTemplate(templateDir);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('copies the whole template tree, overwrites generated data files, copies referenced sheet PNGs, and writes the marker', () => {
    const pngBytes = makePng('game-a-ground-sheet');
    const sha256 = storeObjectFor(storeDir, pngBytes);
    const doc = makeDoc({ A2: { object: sha256, sourceTilesetId: 1, sourceGameId: 1 } });

    const result = runExport({ templateDir, outDir, storeDir, map: doc, markerVersion: null });

    // Template files survived the copy untouched.
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(readFileSync(join(outDir, 'js', 'main.js'), 'utf8')).toBe(
      '// synthetic template main.js',
    );
    expect(readFileSync(join(outDir, 'data', 'System.json'), 'utf8')).toBe('{"placeholder":true}');

    // Generated data files overwrote the template's placeholders.
    const tilesets = JSON.parse(readFileSync(join(outDir, 'data', 'Tilesets.json'), 'utf8'));
    expect(tilesets[1].tilesetNames[1]).toMatch(/^A2_/);
    const mapInfos = JSON.parse(readFileSync(join(outDir, 'data', 'MapInfos.json'), 'utf8'));
    expect(mapInfos[1].name).toBe('Demo Map');
    const map001 = JSON.parse(readFileSync(join(outDir, 'data', 'Map001.json'), 'utf8'));
    expect(map001.data).toHaveLength(2 * 2 * 6);

    // The referenced sheet PNG was copied into img/tilesets, byte-identical.
    const copiedSheetPath = join(outDir, 'img', 'tilesets', `${tilesets[1].tilesetNames[1]}.png`);
    expect(existsSync(copiedSheetPath)).toBe(true);
    expect(readFileSync(copiedSheetPath)).toEqual(pngBytes);

    // Marker written with the fallback value (markerVersion: null -> no detection input given).
    expect(readFileSync(join(outDir, 'game.rmmzproject'), 'utf8')).toBe('RPGMZ 0.9.4');

    expect(result.report.composedSlots).toEqual(['A2']);
  });

  it('throws a typed error when a composed slot references an object missing from the store', () => {
    const doc = makeDoc({
      A2: { object: 'deadbeef'.repeat(8), sourceTilesetId: 1, sourceGameId: 1 },
    });
    expect(() =>
      runExport({ templateDir, outDir, storeDir, map: doc, markerVersion: null }),
    ).toThrow(ExportError);
  });

  it('throws a typed error rather than silently clobbering an existing, non-empty output directory', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'preexisting.txt'), 'do not clobber me');
    const doc = makeDoc({});
    expect(() =>
      runExport({ templateDir, outDir, storeDir, map: doc, markerVersion: null }),
    ).toThrow(ExportError);
  });
});

describe('findInstalledMarkerVersion', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'threemaker-marker-scan-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('finds a valid marker file within the bounded depth and returns its trimmed contents', () => {
    const nested = join(workDir, 'dlc', 'A Sample Pack', 'sample_project');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'game.rmmzproject'), 'RPGMZ 0.9.4');

    expect(findInstalledMarkerVersion(workDir)).toBe('RPGMZ 0.9.4');
  });

  it('returns null when no valid marker file exists under the engine dir', () => {
    expect(findInstalledMarkerVersion(workDir)).toBeNull();
  });

  it('is deterministic: given two candidates, always returns the alphabetically-first path', () => {
    mkdirSync(join(workDir, 'dlc', 'Z Pack', 'proj'), { recursive: true });
    writeFileSync(join(workDir, 'dlc', 'Z Pack', 'proj', 'game.rmmzproject'), 'RPGMZ 0.9.5');
    mkdirSync(join(workDir, 'dlc', 'A Pack', 'proj'), { recursive: true });
    writeFileSync(join(workDir, 'dlc', 'A Pack', 'proj', 'game.rmmzproject'), 'RPGMZ 0.9.4');

    expect(findInstalledMarkerVersion(workDir)).toBe('RPGMZ 0.9.4');
  });
});
