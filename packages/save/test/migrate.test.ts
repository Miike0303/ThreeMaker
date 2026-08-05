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

describe('save migration registry', () => {
  beforeEach(() => {
    clearSaveMigrations();
    registerSaveMigration(0, migrateTestFixtureV0ToV1);
  });

  afterEach(() => {
    clearSaveMigrations();
  });

  it('migrates a test-fixture v0 document to CURRENT via the registry loop', () => {
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
  });

  it('parseGameSaveDocument accepts v0 fixture after migration and validates v1 shape', () => {
    const parsed = parseGameSaveDocument(makeV0Fixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(1);
    expect(parsed.document.player.x).toBe(3);
    expect(parsed.document.world.met_elder).toBe(true);
  });

  it('leaves a current v1 document unchanged when no steps are needed', () => {
    const v1 = {
      magic: GAME_SAVE_MAGIC,
      version: 1,
      player: {
        mapFile: 'current.tmmap.json',
        x: 1,
        y: 2,
        floor: 0,
        facing: 'up',
      },
      world: {},
    };
    const result = migrateSaveDocumentToCurrent(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw.version).toBe(1);
    expect(result.raw.player).toEqual(v1.player);
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
});
