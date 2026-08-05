/**
 * Version dispatch + migration registry for game-save documents.
 * Same pattern as `map-format/migrate.ts`: `v(n) -> v(n+1)` steps until
 * {@link CURRENT_GAME_SAVE_VERSION}. Unknown/newer versions fail closed.
 *
 * Production currently has CURRENT = 1 and **no built-in product migrations**.
 * The loop is exercised with a test-only v0→v1 step registered in tests
 * (see `migrate.test.ts`), matching map-format's use of `registerMigration(0, …)`
 * for dispatch coverage without inventing a real product schema.
 */

import { CURRENT_GAME_SAVE_VERSION, GAME_SAVE_MAGIC } from './constants.js';

/** A migration takes a raw document at `fromVersion` and returns one at `fromVersion + 1`. */
export type SaveMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

const migrations = new Map<number, SaveMigration>();

/** Register `fromVersion` → `fromVersion + 1`. Last registration wins. */
export function registerSaveMigration(fromVersion: number, migration: SaveMigration): void {
  migrations.set(fromVersion, migration);
}

/**
 * Clears every registered migration (including any test fixture steps).
 * Production ships with an empty registry until a real v2 exists.
 */
export function clearSaveMigrations(): void {
  migrations.clear();
}

export type MigrateSaveResult =
  | { readonly ok: true; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

/**
 * Walk registered migrations until CURRENT. Caller must already verify magic.
 * Never throws — missing steps / bad version yield `{ ok: false }`.
 */
export function migrateSaveDocumentToCurrent(raw: Record<string, unknown>): MigrateSaveResult {
  if (raw.magic !== GAME_SAVE_MAGIC) {
    return { ok: false, reason: 'missing or invalid magic' };
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) {
    return { ok: false, reason: 'version must be an integer' };
  }

  let version = raw.version;
  if (version > CURRENT_GAME_SAVE_VERSION) {
    return {
      ok: false,
      reason: `unknown or unsupported version ${version}`,
    };
  }

  let doc: Record<string, unknown> = { ...raw };
  while (version < CURRENT_GAME_SAVE_VERSION) {
    const step = migrations.get(version);
    if (!step) {
      return {
        ok: false,
        reason: `no migration registered from version ${version} to ${version + 1}`,
      };
    }
    try {
      doc = step(doc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `migration from ${version} failed: ${message}` };
    }
    if (typeof doc.version !== 'number' || !Number.isInteger(doc.version)) {
      return { ok: false, reason: `migration from ${version} did not set an integer version` };
    }
    if (doc.version !== version + 1) {
      return {
        ok: false,
        reason: `migration from ${version} produced version ${String(doc.version)}, expected ${version + 1}`,
      };
    }
    version = doc.version;
  }

  return { ok: true, raw: doc };
}

/**
 * **TEST FIXTURE ONLY** — not a product schema.
 *
 * Synthetic v0: flat player fields at the top level (no `player` wrapper).
 * Migrates to the real v1 shape so the registry loop is exercised without
 * inventing a second product version before C4 inventory needs one.
 */
export function migrateTestFixtureV0ToV1(doc: Record<string, unknown>): Record<string, unknown> {
  const { mapFile, x, y, floor, facing, world, magic } = doc;
  return {
    magic: magic ?? GAME_SAVE_MAGIC,
    version: 1,
    player: { mapFile, x, y, floor, facing },
    world: world ?? {},
  };
}
