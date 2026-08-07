import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_GAME_SAVE_VERSION,
  GAME_SAVE_MAGIC,
  parseGameSaveDocument,
} from '../src/document.js';
import {
  clearSaveMigrations,
  migrateSaveDocumentToCurrent,
  migrateTestFixtureV0ToV1,
  migrateV1ToV2,
  registerSaveMigration,
} from '../src/migrate.js';

/**
 * Synthetic v0 (TEST FIXTURE ONLY): flat player fields, no `player` wrapper.
 * Not a product schema — only exercises the migration registry loop.
 */
function makeV0Fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    magic: GAME_SAVE_MAGIC,
    version: 0,
    mapFile: 'demo/map-a.tmmap.json',
    x: 3,
    y: 4,
    floor: 0,
    facing: 'left',
    world: { met_elder: true, gold: 9 },
    ...overrides,
  };
}

function makeV1Doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    magic: GAME_SAVE_MAGIC,
    version: 1,
    player: {
      mapFile: 'current.tmmap.json',
      x: 1,
      y: 2,
      floor: 0,
      facing: 'up',
    },
    world: { flag: true },
    ...overrides,
  };
}

describe('save migration registry', () => {
  beforeEach(() => {
    clearSaveMigrations();
    // Production product step (restored after clear) + test-only v0 fixture.
    registerSaveMigration(1, migrateV1ToV2);
    registerSaveMigration(0, migrateTestFixtureV0ToV1);
  });

  afterEach(() => {
    // clearSaveMigrations wipes built-ins — restore production v1→v2 so later
    // files that import the package keep a working registry.
    clearSaveMigrations();
    registerSaveMigration(1, migrateV1ToV2);
  });

  it('migrates a test-fixture v0 document through v1→v2 to CURRENT', () => {
    const result = migrateSaveDocumentToCurrent(makeV0Fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw.version).toBe(CURRENT_GAME_SAVE_VERSION);
    expect(result.raw.player).toEqual({
      mapFile: 'demo/map-a.tmmap.json',
      x: 3,
      y: 4,
      floor: 0,
      facing: 'left',
    });
    expect(result.raw.world).toEqual({ met_elder: true, gold: 9 });
    expect(result.raw.inventory).toEqual({});
    expect(result.raw.stats).toEqual({});
  });

  it('parseGameSaveDocument accepts v0 fixture after the full migration chain', () => {
    const parsed = parseGameSaveDocument(makeV0Fixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(CURRENT_GAME_SAVE_VERSION);
    expect(parsed.document.version).toBe(2);
    expect(parsed.document.player.x).toBe(3);
    expect(parsed.document.world.met_elder).toBe(true);
    expect(parsed.document.inventory).toEqual({});
    expect(parsed.document.stats).toEqual({});
  });

  it('migrates a product v1 document to v2 by adding empty inventory/stats', () => {
    const result = migrateSaveDocumentToCurrent(makeV1Doc());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw.version).toBe(2);
    expect(result.raw.player).toEqual(makeV1Doc().player);
    expect(result.raw.world).toEqual({ flag: true });
    expect(result.raw.inventory).toEqual({});
    expect(result.raw.stats).toEqual({});
  });

  it('parseGameSaveDocument accepts a product v1 payload and returns v2', () => {
    const parsed = parseGameSaveDocument(makeV1Doc({ world: { met_elder: true } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(2);
    expect(parsed.document.inventory).toEqual({});
    expect(parsed.document.stats).toEqual({});
    expect(parsed.document.world.met_elder).toBe(true);
  });

  it('leaves a current v2 document unchanged when no steps are needed', () => {
    const v2 = {
      magic: GAME_SAVE_MAGIC,
      version: 2,
      player: {
        mapFile: 'current.tmmap.json',
        x: 1,
        y: 2,
        floor: 0,
        facing: 'up',
      },
      world: {},
      inventory: { potion: 1 },
      stats: { hp: 10 },
    };
    const result = migrateSaveDocumentToCurrent(v2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw.version).toBe(2);
    expect(result.raw.player).toEqual(v2.player);
    expect(result.raw.inventory).toEqual({ potion: 1 });
    expect(result.raw.stats).toEqual({ hp: 10 });
  });

  it('rejects versions newer than CURRENT without throwing', () => {
    const result = migrateSaveDocumentToCurrent({
      magic: GAME_SAVE_MAGIC,
      version: CURRENT_GAME_SAVE_VERSION + 1,
      player: {},
      world: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported version/);
  });

  it('rejects an older version with no registered migration path', () => {
    clearSaveMigrations();
    const result = migrateSaveDocumentToCurrent(makeV0Fixture());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no migration registered from version 0/);
  });

  it('migrateV1ToV2 stamps version 2 and empty stores without touching player/world', () => {
    const v1 = makeV1Doc({ world: { a: 1 } });
    const next = migrateV1ToV2(v1);
    expect(next.version).toBe(2);
    expect(next.inventory).toEqual({});
    expect(next.stats).toEqual({});
    expect(next.player).toEqual(v1.player);
    expect(next.world).toEqual({ a: 1 });
    expect(next.magic).toBe(GAME_SAVE_MAGIC);
  });
});
