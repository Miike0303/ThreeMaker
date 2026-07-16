import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanGames } from '../src/scanner.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'assets-scanner-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeSystemJson(dataDir: string, systemJson: Record<string, unknown> | string): void {
  mkdirSync(dataDir, { recursive: true });
  const contents = typeof systemJson === 'string' ? systemJson : JSON.stringify(systemJson);
  writeFileSync(join(dataDir, 'System.json'), contents, 'utf8');
}

const VALID_SYSTEM_JSON = { gameTitle: 'Test Game', hasEncryptedImages: false };
const ENCRYPTED_SYSTEM_JSON = {
  gameTitle: 'Encrypted Game',
  hasEncryptedImages: true,
  encryptionKey: 'd41d8cd98f00b204e9800998ecf8427e',
};

describe('scanGames — depth/cycle guard (modeled on the LoQOO self-nested folder case)', () => {
  it('abandons a runaway branch once it exceeds maxDepth, without descending forever', () => {
    // Build a chain of plain nested folders (no System.json anywhere) well
    // beyond a small maxDepth — mirrors LoQOO's real `output/output/...`
    // self-nesting, just with short names to stay under Windows MAX_PATH.
    let current = join(workDir, 'o');
    mkdirSync(current, { recursive: true });
    for (let i = 0; i < 20; i++) {
      current = join(current, 'o');
      mkdirSync(current, { recursive: true });
    }

    const result = scanGames(workDir, { maxDepth: 5 });

    expect(result.games).toHaveLength(0);
    const depthErrors = result.errors.filter((e) => e.code === 'depth-exceeded');
    // Exactly one depth-exceeded error for the single runaway branch proves
    // the guard cut the branch instead of recording one error per level.
    expect(depthErrors).toHaveLength(1);
  });

  it('abandons a branch that revisits an already-seen real path (junction cycle)', () => {
    const gameDir = join(workDir, 'game');
    mkdirSync(gameDir, { recursive: true });
    // A junction that points back to workDir itself, forming a real cycle.
    symlinkSync(workDir, join(gameDir, 'loop-back'), 'junction');

    const result = scanGames(workDir, { maxDepth: 12 });

    const cycleErrors = result.errors.filter((e) => e.code === 'cycle-detected');
    expect(cycleErrors.length).toBeGreaterThan(0);
  });
});

describe('scanGames — folder-agnostic MV/MZ auto-detect', () => {
  it('detects an MZ game (data/) and an MV game (www/data/) under the same root', () => {
    const mzRoot = join(workDir, 'mz-game');
    writeSystemJson(join(mzRoot, 'data'), ENCRYPTED_SYSTEM_JSON);
    mkdirSync(join(mzRoot, 'img', 'tilesets'), { recursive: true });
    writeFileSync(join(mzRoot, 'img', 'tilesets', 'Outside.rpgmvp'), 'fake-encrypted-bytes');
    mkdirSync(join(mzRoot, 'audio', 'bgm'), { recursive: true });
    writeFileSync(join(mzRoot, 'audio', 'bgm', 'Theme.ogg_'), 'fake-encrypted-audio');

    const mvRoot = join(workDir, 'mv-game');
    writeSystemJson(join(mvRoot, 'www', 'data'), VALID_SYSTEM_JSON);
    mkdirSync(join(mvRoot, 'www', 'img', 'characters'), { recursive: true });
    writeFileSync(join(mvRoot, 'www', 'img', 'characters', 'Actor1.png'), 'fake-plain-png');

    const result = scanGames(workDir, { maxDepth: 12 });

    expect(result.errors).toHaveLength(0);
    expect(result.games).toHaveLength(2);

    const mz = result.games.find((g) => g.rootPath === mzRoot);
    expect(mz).toBeDefined();
    expect(mz?.engine).toBe('mz');
    expect(mz?.hasEncryptedImages).toBe(true);
    expect(mz?.hasEncryptedAudio).toBe(false); // absent from System.json → defaults false
    expect(mz?.encryptionKey).not.toBeNull();
    expect(mz?.imageAssets).toEqual(['tilesets/Outside.rpgmvp']);
    expect(mz?.audioAssets).toEqual(['bgm/Theme.ogg_']);

    const mv = result.games.find((g) => g.rootPath === mvRoot);
    expect(mv).toBeDefined();
    expect(mv?.engine).toBe('mv');
    expect(mv?.hasEncryptedImages).toBe(false);
    expect(mv?.hasEncryptedAudio).toBe(false);
    expect(mv?.encryptionKey).toBeNull();
    expect(mv?.imageAssets).toEqual(['characters/Actor1.png']);
    expect(mv?.audioAssets).toEqual([]);
  });
});

describe('scanGames — encryption flags model ground truth, not derived from key parseability', () => {
  it('reflects hasEncryptedImages=false even when a parseable key is present', () => {
    const gameDir = join(workDir, 'flagged-false-with-key');
    writeSystemJson(join(gameDir, 'data'), {
      gameTitle: 'Key present, flag false',
      hasEncryptedImages: false,
      hasEncryptedAudio: false,
      encryptionKey: 'd41d8cd98f00b204e9800998ecf8427e',
    });

    const result = scanGames(workDir, { maxDepth: 12 });

    expect(result.errors).toHaveLength(0);
    const game = result.games.find((g) => g.rootPath === gameDir);
    expect(game).toBeDefined();
    // The key is parseable, but the game's own flags say it's not encrypted —
    // ground truth must come from the flags, not from "can we parse a key".
    expect(game?.hasEncryptedImages).toBe(false);
    expect(game?.hasEncryptedAudio).toBe(false);
    expect(game?.encryptionKey).not.toBeNull();
  });

  it('records hasEncryptedImages=true faithfully even when no parseable key is present (broken game)', () => {
    const gameDir = join(workDir, 'flagged-true-no-key');
    writeSystemJson(join(gameDir, 'data'), {
      gameTitle: 'Flag true, no usable key',
      hasEncryptedImages: true,
      hasEncryptedAudio: true,
      // encryptionKey deliberately absent — a broken/incomplete game export.
    });

    const result = scanGames(workDir, { maxDepth: 12 });

    expect(result.errors).toHaveLength(0);
    const game = result.games.find((g) => g.rootPath === gameDir);
    expect(game).toBeDefined();
    expect(game?.hasEncryptedImages).toBe(true);
    expect(game?.hasEncryptedAudio).toBe(true);
    expect(game?.encryptionKey).toBeNull();
  });
});

describe('scanGames — asset-tree traversal shares the same guarded walk as the game-root walk', () => {
  it('abandons a runaway branch inside img/ once it exceeds maxDepth', () => {
    const gameDir = join(workDir, 'deep-assets-game');
    writeSystemJson(join(gameDir, 'data'), VALID_SYSTEM_JSON);

    let current = join(gameDir, 'img', 'o');
    mkdirSync(current, { recursive: true });
    for (let i = 0; i < 20; i++) {
      current = join(current, 'o');
      mkdirSync(current, { recursive: true });
    }

    const result = scanGames(workDir, { maxDepth: 5 });

    const game = result.games.find((g) => g.rootPath === gameDir);
    expect(game).toBeDefined();
    expect(game?.imageAssets).toEqual([]);

    const depthErrors = result.errors.filter((e) => e.code === 'depth-exceeded');
    expect(depthErrors.length).toBeGreaterThan(0);
  });

  it('abandons a branch inside audio/ that revisits an already-seen real path (junction cycle)', () => {
    const gameDir = join(workDir, 'cyclic-assets-game');
    writeSystemJson(join(gameDir, 'data'), VALID_SYSTEM_JSON);

    const audioDir = join(gameDir, 'audio');
    mkdirSync(audioDir, { recursive: true });
    // A junction inside the asset tree that points back to the game's audio
    // root, forming a real cycle scoped to the asset walk (not the game walk).
    symlinkSync(audioDir, join(audioDir, 'loop-back'), 'junction');

    const result = scanGames(workDir, { maxDepth: 12 });

    const game = result.games.find((g) => g.rootPath === gameDir);
    expect(game).toBeDefined();

    const cycleErrors = result.errors.filter((e) => e.code === 'cycle-detected');
    expect(cycleErrors.length).toBeGreaterThan(0);
  });
});

describe('scanGames — UTF-8 BOM tolerance', () => {
  it('reads a System.json prefixed with a UTF-8 BOM instead of skipping the whole game (invalid-system-json)', () => {
    const gameDir = join(workDir, 'bom-game');
    // Some deployed games ship System.json re-saved with a leading BOM
    // (EF BB BF) by editors/translation tools -- JSON.parse throws on it
    // unless stripped first.
    writeSystemJson(join(gameDir, 'data'), `﻿${JSON.stringify(VALID_SYSTEM_JSON)}`);

    const result = scanGames(workDir, { maxDepth: 12 });

    expect(result.errors).toHaveLength(0);
    const game = result.games.find((g) => g.rootPath === gameDir);
    expect(game).toBeDefined();
    expect(game?.hasEncryptedImages).toBe(false);
  });
});

describe('scanGames — per-game error isolation', () => {
  it('reports a corrupt System.json as an error without aborting the rest of the run', () => {
    const goodGameA = join(workDir, 'good-a');
    writeSystemJson(join(goodGameA, 'data'), VALID_SYSTEM_JSON);

    const brokenGame = join(workDir, 'broken');
    writeSystemJson(join(brokenGame, 'data'), '{ this is not valid json ');

    const goodGameC = join(workDir, 'good-c');
    writeSystemJson(join(goodGameC, 'data'), VALID_SYSTEM_JSON);

    const result = scanGames(workDir, { maxDepth: 12 });

    expect(result.games).toHaveLength(2);
    expect(result.games.map((g) => g.rootPath).sort()).toEqual([goodGameA, goodGameC].sort());

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('invalid-system-json');
    expect(result.errors[0]?.path).toBe(brokenGame);
  });
});
