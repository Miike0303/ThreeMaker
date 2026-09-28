import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('uses the first actor when System.json is missing', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Sidekick', characterName: 'Actor2', characterIndex: 1 },
    ]);

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor1', characterIndex: 0 });
  });

  it('reads the lead actor from an MZ data directory', () => {
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([null, { characterName: 'MZHero', characterIndex: 2 }]),
      'utf8',
    );

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'MZHero', characterIndex: 2 });
  });

  it('uses the starting party leader from System.json beside MZ Actors.json', () => {
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([
        null,
        { characterName: 'FirstActor', characterIndex: 0 },
        { characterName: 'PartyLeader', characterIndex: 3 },
      ]),
      'utf8',
    );
    writeFileSync(join(dataDir, 'System.json'), JSON.stringify({ partyMembers: [2] }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({
      characterName: 'PartyLeader',
      characterIndex: 3,
    });
  });

  it('reads the lead actor from a deployed MV www/data directory', () => {
    const dataDir = join(gameDir, 'www', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([null, { characterName: 'MVHero', characterIndex: 5 }]),
      'utf8',
    );

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'MVHero', characterIndex: 5 });
  });

  it('uses the first defined actor when actor 1 is missing', () => {
    writeActors([
      null,
      null,
      { id: 2, name: 'Actor2', characterName: 'Actor2', characterIndex: 1 },
    ]);

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor2', characterIndex: 1 });
  });

  it('uses the first starting party member instead of the first actor', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Leader', characterName: 'Actor2', characterIndex: 3 },
    ]);
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ partyMembers: [2] }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor2', characterIndex: 3 });
  });

  it('uses the first actor when the starting party member has no actor entry', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Sidekick', characterName: 'Actor2', characterIndex: 1 },
    ]);
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ partyMembers: [99] }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor1', characterIndex: 0 });
  });

  it('keeps the first actor when partyMembers is an object with a numeric key', () => {
    writeActors([
      null,
      { characterName: 'FallbackHero', characterIndex: 1 },
      { characterName: 'OtherHero', characterIndex: 3 },
    ]);
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ partyMembers: { 0: 2 } }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({
      characterName: 'FallbackHero',
      characterIndex: 1,
    });
  });

  it('keeps the first actor when the selected leader entry is an array', () => {
    writeActors([null, { characterName: 'FallbackHero', characterIndex: 1 }, []]);
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ partyMembers: [2] }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({
      characterName: 'FallbackHero',
      characterIndex: 1,
    });
  });

  it('keeps the first actor when the selected leader entry is null', () => {
    writeActors([null, { characterName: 'FallbackHero', characterIndex: 1 }, null]);
    writeFileSync(join(gameDir, 'System.json'), JSON.stringify({ partyMembers: [2] }), 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({
      characterName: 'FallbackHero',
      characterIndex: 1,
    });
  });

  it('keeps the first actor as fallback when System.json is malformed', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Sidekick', characterName: 'Actor2', characterIndex: 1 },
    ]);
    writeFileSync(join(gameDir, 'System.json'), 'not valid json', 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor1', characterIndex: 0 });
  });

  it('tolerates a UTF-8 BOM before System.json', () => {
    writeActors([
      null,
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
      { id: 2, name: 'Leader', characterName: 'Actor2', characterIndex: 4 },
    ]);
    writeFileSync(join(gameDir, 'System.json'), `﻿${JSON.stringify({ partyMembers: [2] })}`, 'utf8');

    expect(readLeadActorSheet(gameDir)).toEqual({ characterName: 'Actor2', characterIndex: 4 });
  });

  it('returns undefined for a $-prefixed single-character sheet (different frame grid, out of scope)', () => {
    writeActors([null, { id: 1, name: 'Hero', characterName: '$BigMonster', characterIndex: 0 }]);

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('allows a dollar sign inside a standard character sheet name', () => {
    writeActors([null, { characterName: 'Actor$Variant', characterIndex: 0 }]);

    expect(readLeadActorSheet(gameDir)).toEqual({
      characterName: 'Actor$Variant',
      characterIndex: 0,
    });
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

  it('does not hide a malformed first Actors.json behind a later valid candidate', () => {
    writeFileSync(join(gameDir, 'Actors.json'), 'not valid json', 'utf8');
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([null, { characterName: 'Actor1', characterIndex: 0 }]),
      'utf8',
    );

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('mutation pin: does not use later actors when the first Actors.json is not an array', () => {
    writeFileSync(join(gameDir, 'Actors.json'), '{}', 'utf8');
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([null, { characterName: 'LaterHero', characterIndex: 1 }]),
      'utf8',
    );

    expect(readLeadActorSheet(gameDir)).toBeUndefined();
  });

  it('mutation pin: does not use later actors when the first actor lacks an index', () => {
    writeActors([null, { characterName: 'IncompleteHero' }]);
    const dataDir = join(gameDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, 'Actors.json'),
      JSON.stringify([null, { characterName: 'LaterHero', characterIndex: 1 }]),
      'utf8',
    );

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
