import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_GAME_SAVE_VERSION,
  GAME_SAVE_MAGIC,
  parseGameSaveDocument,
  serializeGameSaveDocument,
} from '../src/document.js';
import {
  clearSaveMigrations,
  migrateV1ToV2,
  migrateV2ToV3,
  registerSaveMigration,
} from '../src/migrate.js';
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
  inventory: { potion: 2, key: 1 },
  stats: { hp: 42, mp: 10 },
  stories: { elder: '{"inkSaveVersion":8}' },
};

function registerProductMigrations(): void {
  registerSaveMigration(1, migrateV1ToV2);
  registerSaveMigration(2, migrateV2ToV3);
}

// Restore production migrations after any clear (registry wipe includes built-ins).
beforeEach(() => {
  clearSaveMigrations();
  registerProductMigrations();
});
afterEach(() => {
  clearSaveMigrations();
  registerProductMigrations();
});

describe('serializeGameSaveDocument / parseGameSaveDocument', () => {
  it('round-trips a valid v3 document', () => {
    const doc = gameSaveDocumentFromSnapshot(sampleSnapshot);
    const text = serializeGameSaveDocument(doc);
    const parsed = parseGameSaveDocument(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(CURRENT_GAME_SAVE_VERSION);
    expect(parsed.document.magic).toBe(GAME_SAVE_MAGIC);
    expect(parsed.document.version).toBe(3);
    expect(snapshotFromGameSaveDocument(parsed.document)).toEqual(sampleSnapshot);
  });

  it('rejects missing magic, non-objects, and unknown versions without throwing', () => {
    expect(parseGameSaveDocument(null).ok).toBe(false);
    expect(parseGameSaveDocument({ version: 2 }).ok).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 99,
        player: samplePlayer(),
        world: {},
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: 'other',
        version: 2,
        player: samplePlayer(),
        world: {},
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
  });

  it('rejects malformed player or world entries', () => {
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 2,
        player: { ...samplePlayer(), facing: 'north' },
        world: {},
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 2,
        player: { ...samplePlayer(), floor: -1 },
        world: {},
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 2,
        player: samplePlayer(),
        world: { bad: { nested: true } },
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
    expect(
      parseGameSaveDocument({
        magic: GAME_SAVE_MAGIC,
        version: 2,
        player: samplePlayer(),
        world: null,
        inventory: {},
        stats: {},
      }).ok,
    ).toBe(false);
  });

  it('accepts empty world/inventory/stats/stories and integer player coords', () => {
    const parsed = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 3,
      player: { mapFile: 'current.tmmap.json', x: 0, y: 0, floor: 0, facing: 'up' },
      world: {},
      inventory: {},
      stats: {},
      stories: {},
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.inventory).toEqual({});
    expect(parsed.document.stats).toEqual({});
    expect(parsed.document.stories).toEqual({});
  });

  it('rejects bad inventory shapes with a precise reason', () => {
    const base = {
      magic: GAME_SAVE_MAGIC,
      version: 2,
      player: samplePlayer(),
      world: {},
      stats: {},
    };
    expect(parseGameSaveDocument({ ...base, inventory: null }).ok).toBe(false);
    expect(parseGameSaveDocument({ ...base, inventory: [] }).ok).toBe(false);
    const neg = parseGameSaveDocument({ ...base, inventory: { potion: -1 } });
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.reason).toMatch(/inventory/i);
    const frac = parseGameSaveDocument({ ...base, inventory: { potion: 1.5 } });
    expect(frac.ok).toBe(false);
    if (!frac.ok) expect(frac.reason).toMatch(/inventory/i);
    const zero = parseGameSaveDocument({ ...base, inventory: { potion: 0 } });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.reason).toMatch(/inventory/i);
    const missing = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 2,
      player: samplePlayer(),
      world: {},
      stats: {},
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/inventory/i);
  });

  it('rejects bad stats shapes with a precise reason', () => {
    const base = {
      magic: GAME_SAVE_MAGIC,
      version: 2,
      player: samplePlayer(),
      world: {},
      inventory: {},
    };
    expect(parseGameSaveDocument({ ...base, stats: null }).ok).toBe(false);
    expect(parseGameSaveDocument({ ...base, stats: [] }).ok).toBe(false);
    const nan = parseGameSaveDocument({ ...base, stats: { hp: Number.NaN } });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.reason).toMatch(/stats/i);
    const inf = parseGameSaveDocument({ ...base, stats: { hp: Number.POSITIVE_INFINITY } });
    expect(inf.ok).toBe(false);
    if (!inf.ok) expect(inf.reason).toMatch(/stats/i);
    const str = parseGameSaveDocument({ ...base, stats: { hp: '10' } });
    expect(str.ok).toBe(false);
    if (!str.ok) expect(str.reason).toMatch(/stats/i);
    const missing = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 3,
      player: samplePlayer(),
      world: {},
      inventory: {},
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/stats/i);
  });

  it('rejects bad stories shapes with a precise reason', () => {
    const base = {
      magic: GAME_SAVE_MAGIC,
      version: 3,
      player: samplePlayer(),
      world: {},
      inventory: {},
      stats: {},
    };
    expect(parseGameSaveDocument({ ...base, stories: null }).ok).toBe(false);
    expect(parseGameSaveDocument({ ...base, stories: [] }).ok).toBe(false);
    const empty = parseGameSaveDocument({ ...base, stories: { elder: '' } });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toMatch(/stories/i);
    const num = parseGameSaveDocument({ ...base, stories: { elder: 1 } });
    expect(num.ok).toBe(false);
    if (!num.ok) expect(num.reason).toMatch(/stories/i);
    const missing = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 3,
      player: samplePlayer(),
      world: {},
      inventory: {},
      stats: {},
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/stories/i);
  });

  it('migrates a C3-era v1 document to v3 with empty inventory/stats/stories', () => {
    const parsed = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 1,
      player: samplePlayer(),
      world: { met_elder: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(3);
    expect(parsed.document.version).toBe(3);
    expect(parsed.document.world).toEqual({ met_elder: true });
    expect(parsed.document.inventory).toEqual({});
    expect(parsed.document.stats).toEqual({});
    expect(parsed.document.stories).toEqual({});
  });

  it('migrates a C4-era v2 document to v3 with empty stories', () => {
    const parsed = parseGameSaveDocument({
      magic: GAME_SAVE_MAGIC,
      version: 2,
      player: samplePlayer(),
      world: { met_elder: true },
      inventory: { potion: 1 },
      stats: { hp: 10 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(3);
    expect(parsed.document.version).toBe(3);
    expect(parsed.document.inventory).toEqual({ potion: 1 });
    expect(parsed.document.stats).toEqual({ hp: 10 });
    expect(parsed.document.stories).toEqual({});
  });
});

describe('snapshot bridge (pure runtime ↔ document)', () => {
  it('builds a document from a runtime snapshot and restores it', () => {
    const doc = gameSaveDocumentFromSnapshot(sampleSnapshot);
    expect(doc.version).toBe(CURRENT_GAME_SAVE_VERSION);
    expect(doc.player.mapFile).toBe('demo/map-a.tmmap.json');
    expect(doc.inventory).toEqual(sampleSnapshot.inventory);
    expect(doc.stats).toEqual(sampleSnapshot.stats);
    expect(doc.stories).toEqual(sampleSnapshot.stories);
    expect(snapshotFromGameSaveDocument(doc)).toEqual(sampleSnapshot);
  });

  it('copies world/inventory/stats/stories entries (no shared mutable reference)', () => {
    const world = { flag: true as const };
    const inventory = { potion: 1 };
    const stats = { hp: 5 };
    const stories = { elder: '{"inkSaveVersion":8}' };
    const doc = gameSaveDocumentFromSnapshot({
      ...sampleSnapshot,
      world,
      inventory,
      stats,
      stories,
    });
    world.flag = false;
    inventory.potion = 99;
    stats.hp = 0;
    stories.elder = 'mutated';
    expect(doc.world.flag).toBe(true);
    expect(doc.inventory.potion).toBe(1);
    expect(doc.stats.hp).toBe(5);
    expect(doc.stories.elder).toBe('{"inkSaveVersion":8}');
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
