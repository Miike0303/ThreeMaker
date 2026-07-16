import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLeadActorSheet } from '../src/rpgm-actors.js';

describe('readLeadActorSheet', () => {
  let gameDir: string;

  beforeEach(() => {
    gameDir = mkdtempSync(join(tmpdir(), 'threemaker-rpgm-actors-test-'));
  });

  afterEach(() => {
    rmSync(gameDir, { recursive: true, force: true });
  });

  function writeActors(actors: unknown[]): void {
    writeFileSync(join(gameDir, 'Actors.json'), JSON.stringify(actors), 'utf8');
  }

  it('reads the first actor entry (index 1, RPGM 1-indexed sparse array)', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Sidekick', characterName: 'Actor1', characterIndex: 1 },
    ]);

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor1', characterIndex: 0 });
  });

  it('returns undefined for a $-prefixed single-character sheet (different frame grid, out of scope)', () => {
    writeActors([null, { id: 1, name: 'Hero', characterName: '$BigMonster', characterIndex: 0 }]);

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('returns undefined when the first actor has no characterName', () => {
    writeActors([null, { id: 1, name: 'Hero', characterName: '', characterIndex: 0 }]);

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('returns undefined when Actors.json does not exist', () => {
    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('returns undefined when Actors.json is malformed', () => {
    writeFileSync(join(gameDir, 'Actors.json'), 'not valid json', 'utf8');

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('tolerates a UTF-8 BOM before the JSON payload', () => {
    writeFileSync(
      join(gameDir, 'Actors.json'),
      `﻿${JSON.stringify([null, { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 2 }])}`,
      'utf8',
    );

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor1', characterIndex: 2 });
  });
});
