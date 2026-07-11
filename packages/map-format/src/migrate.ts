/**
 * Version dispatch + migration registry for `.tmmap.json` documents. This is
 * the entry point real callers (editor save/load, CLI, tests) use --
 * `schema.ts`'s `validateCurrentVersionShape` only validates a document
 * already AT the current version, to avoid a circular import back into this
 * module.
 *
 * Migration policy (design): registered `v(n) -> v(n+1)` functions, applied
 * in a loop until the document reaches `CURRENT_MAP_FORMAT_VERSION`. A
 * version newer than what this build understands is rejected with a typed
 * error rather than silently truncated/misread.
 */

import type { MapDocument } from './schema.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  MapFormatError,
  validateCurrentVersionShape,
} from './schema.js';

/** A migration takes a raw (already magic/version-checked) document at version `fromVersion` and returns one at `fromVersion + 1`. */
export type MapMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

const migrations = new Map<number, MapMigration>();

/** Registers a migration from `fromVersion` to `fromVersion + 1`. Re-registering the same `fromVersion` overwrites (last registration wins), matching a simple registry with no ordering surprises. */
export function registerMigration(fromVersion: number, migration: MapMigration): void {
  migrations.set(fromVersion, migration);
}

/** Test/introspection helper: clears all registered migrations. Production code never needs this (there are no registered migrations yet at version 1). */
export function clearMigrations(): void {
  migrations.clear();
}

function readVersion(raw: Record<string, unknown>): number {
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) {
    throw new MapFormatError('malformed', '"version" must be an integer.');
  }
  return raw.version;
}

/**
 * Parses and validates an untrusted JSON value into a `MapDocument`,
 * migrating forward from any older registered version. Rejects:
 *  - a document whose `format` isn't the expected magic string
 *  - a version newer than `CURRENT_MAP_FORMAT_VERSION` (no registered
 *    migration can exist for a version that doesn't exist yet)
 *  - an older version with no registered migration path to the current one
 */
export function parseMapDocument(input: unknown): MapDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', 'Map document must be a non-null object.');
  }
  let raw = input as Record<string, unknown>;

  if (raw.format !== MAP_FORMAT_MAGIC) {
    throw new MapFormatError(
      'bad-magic',
      `Expected "format" to be ${JSON.stringify(MAP_FORMAT_MAGIC)}, got ${JSON.stringify(raw.format)}.`,
    );
  }

  let version = readVersion(raw);
  if (version > CURRENT_MAP_FORMAT_VERSION) {
    throw new MapFormatError(
      'unsupported-version',
      `Map document version ${version} is newer than the current supported version ${CURRENT_MAP_FORMAT_VERSION}. Upgrade the app to open it.`,
    );
  }

  while (version < CURRENT_MAP_FORMAT_VERSION) {
    const migration = migrations.get(version);
    if (!migration) {
      throw new MapFormatError(
        'unsupported-version',
        `No migration registered from map format version ${version} to ${version + 1}.`,
      );
    }
    raw = migration(raw);
    version = readVersion(raw);
  }

  return validateCurrentVersionShape(raw);
}
