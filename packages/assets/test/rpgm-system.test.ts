import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRpgmSystemStart } from '../src/rpgm-system.js';

describe('readRpgmSystemStart', () => {
  let gameDir: string;

  beforeEach(() => {
    gameDir = mkdtempSync(join(tmpdir(), 'threemaker-rpgm-system-test-'));
  });

  afterEach(() => {
    rmSync(gameDir, { recursive: true, force: true });
  });

  it('reads startMapId/startX/startY from a flat-layout System.json', () => {
    writeFileSync(
      join(gameDir, 'System.json'),
      JSON.stringify({ startMapId: 3, startX: 5, startY: 7 }),
      'utf8',
    );

    expect(readRpgmSystemStart(gameDir)).toEqual({ mapId: 3, x: 5, y: 7 });
  });

  it('tolerates a UTF-8 BOM before the JSON payload', () => {
    writeFileSync(
      join(gameDir, 'System.json'),
      `﻿${JSON.stringify({ startMapId: 1, startX: 0, startY: 0 })}`,
      'utf8',
    );

    expect(readRpgmSystemStart(gameDir)).toEqual({ mapId: 1, x: 0, y: 0 });
  });

  it('finds System.json under a `data` subdirectory (MZ layout)', () => {
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'System.json'),
      JSON.stringify({ startMapId: 9, startX: 2, startY: 2 }),
      'utf8',
    );

    expect(readRpgmSystemStart(gameDir)).toEqual({ mapId: 9, x: 2, y: 2 });
  });

  it('returns undefined when no System.json exists under any candidate directory', () => {
    expect(readRpgmSystemStart(gameDir)).toBeUndefined();
  });

  it('returns undefined when System.json is malformed', () => {
    writeFileSync(join(gameDir, 'System.json'), 'not valid json', 'utf8');

    expect(readRpgmSystemStart(gameDir)).toBeUndefined();
  });

  it('returns undefined when the required fields are missing/wrong type', () => {
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ startMapId: 3 }), 'utf8');

    expect(readRpgmSystemStart(gameDir)).toBeUndefined();
  });
});
