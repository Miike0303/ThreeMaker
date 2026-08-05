import { describe, expect, it } from 'vitest';
import {
  CURRENT_GAME_SAVE_VERSION,
  GAME_SAVE_MAGIC,
  parseGameSaveDocument,
  serializeGameSaveDocument,
} from '../src/document.js';
import { gameSaveDocumentFromSnapshot, snapshotFromGameSaveDocument } from '../src/snapshot.js';
import type { GameSaveSnapshot } from '../src/types.js';

const sampleSnapshot: GameSaveSnapshot = {
  mapFile: 'demo/map-a.tmmap.json',
  x: 3,
  y: 7,
  floor: 0,
  facing: 'down',
  world: {
    met_elder: true,
    gold: 12,
    last_town: 'harbor',
  },
};

describe('serializeGameSaveDocument / parseGameSaveDocument', () => {
  it('round-trips a valid v1 document', () => {
    const doc = gameSaveDocumentFromSnapshot(sampleSnapshot);
    const text = serializeGameSaveDocument(doc);
    const parsed = parseGameSaveDocument(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(CURRENT_GAME_SAVE_VERSION);
    expect(parsed.document.magic).toBe(GAME_SAVE_MAGIC);
    expect(snapshotFromGameSaveDocument(parsed.document)).toEqual(sampleSnapshot);
  });

  it('rejects missing magic, non-objects, and unknown versions without throwing', () => {
    expect(parseGameSaveDocument(null).ok).toBe(false);
    expect(parseGameSaveDocument({ version: 1 }).ok).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 99,
        player: samplePlayer(),
        world: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: 'other',
        version: 1,
        player: samplePlayer(),
        world: {},
      }).ok,
    ).toBe(false);
  });

  it('rejects malformed player or world entries', () => {
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 1,
        player: { ...samplePlayer(), facing: 'north' },
        world: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 1,
        player: { ...samplePlayer(), floor: -1 },
        world: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 1,
        player: samplePlayer(),
        world: { bad: { nested: true } },
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 1,
        player: samplePlayer(),
        world: null,
      }).ok,
    ).toBe(false);
  });

  it('accepts empty world and integer player coords', () => {
    const parsed = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 1,
      player: { mapFile: 'current.tmmap.json', x: 0, y: 0, floor: 0, facing: 'up' },
      world: {},
    });
    expect(parsed.ok).toBe(true);
  });
});

describe('snapshot bridge (pure runtime ↔ document)', () => {
  it('builds a document from a runtime snapshot and restores it', () => {
    const doc = gameSaveDocumentFromSnapshot(sampleSnapshot);
    expect(doc.version).toBe(1);
    expect(doc.player.mapFile).toBe('demo/map-a.tmmap.json');
    expect(snapshotFromGameSaveDocument(doc)).toEqual(sampleSnapshot);
  });

  it('copies world entries (no shared mutable reference)', () => {
    const world = { flag: true as const };
    const doc = gameSaveDocumentFromSnapshot({
      ...sampleSnapshot,
      world,
    });
    world.flag = false;
    expect(doc.world.flag).toBe(true);
  });
});

function samplePlayer() {
  return {
    mapFile: 'demo/map-a.tmmap.json',
    x: 1,
    y: 2,
    floor: 0,
    facing: 'left' as const,
  };
}
