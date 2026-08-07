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

import type { FloorDocument, MapDocument, MapLayers } from './schema.js';
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

/**
 * Test/introspection helper: clears all registered migrations, INCLUDING the
 * built-in ones registered below (e.g. `migrateV1ToV2`). Callers that clear
 * migrations to test the generic dispatch/registry mechanism in isolation
 * MUST re-register any built-in migration they still depend on afterward
 * (see `migrate.test.ts`'s `afterEach`).
 */
export function clearMigrations(): void {
  migrations.clear();
}

/**
 * v1 -> v2 lossless wrap (plantas-apiladas schema v2 design): the whole v1
 * document's single `layers` group becomes floor 0's layers, unmodified --
 * no data is dropped, no key is lost. A migrated v1 document has no
 * stair-links (there was only ever one floor to link).
 */
export function migrateV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  const { layers, ...rest } = doc;
  const floor: FloorDocument = {
    id: 'floor-0',
    baseElevation: 0,
    layers: layers as MapLayers,
  };
  return { ...rest, version: 2, floors: [floor], stairLinks: [] };
}

registerMigration(1, migrateV1ToV2);

/**
 * v2 -> v3 lossless wrap (techos-y-oclusion-interiores design, "Migration
 * v2->v3"): a v2 document had no room concept at all, so migration adds an
 * EMPTY `rooms` array and bumps `version` -- every other field passes
 * through unmodified via the spread. "Byte-identical" per spec means render
 * behavior (empty rooms -> empty `roomIdGrid` -> zero carve -> identical
 * geometry) plus zero loss of pre-existing fields; the serialized JSON
 * legitimately gains the `rooms` key (see `migrate.test.ts`'s "v2 -> v3
 * migration (THE compatibility gate)" describe block).
 */
export function migrateV2ToV3(doc: Record<string, unknown>): Record<string, unknown> {
  return { ...doc, version: 3, rooms: [] };
}

registerMigration(2, migrateV2ToV3);

/** The four v4 narrative collections, in the order the v3 guard below names them. */
const V4_NARRATIVE_KEYS = ['npcs', 'triggers', 'events', 'worldSeeds'] as const;

/**
 * v3 -> v4 lossless wrap (authored-events-npcs design, "D4 migration"): a v3
 * document carried no narrative concept at all, so migration adds the four
 * EMPTY narrative collections and bumps `version` -- every other field passes
 * through unmodified via the spread, exactly like `migrateV2ToV3`. The
 * serialized JSON legitimately gains the four keys (see `schema-v4.test.ts`'s
 * migration gate).
 *
 * Because that is a spread THEN an unconditional overwrite, a document that
 * already carries narrative content while still declaring `version: 3` -- a
 * one-character authoring slip in a hand-written map -- would migrate
 * "successfully" with every NPC, trigger, event and seed silently discarded and
 * no error at any layer: exactly the "silently narrative-free map" degradation
 * spec R5 forbids. So that case fails LOUDLY instead, naming the keys found.
 * Absent (`undefined`) keys stay the ordinary v3 case and keep migrating, per
 * `schema.ts`'s own absent-collapses-to-default convention. Checked against the
 * 848 real v3 documents on disk: none carries any of these keys, so this
 * rejects no existing data.
 */
export function migrateV3ToV4(doc: Record<string, unknown>): Record<string, unknown> {
  const carried = V4_NARRATIVE_KEYS.filter((key) => doc[key] !== undefined);
  if (carried.length > 0) {
    throw new MapFormatError(
      'malformed',
      `Map document declares "version": 3 but already carries v4 narrative content (${carried
        .map((key) => JSON.stringify(key))
        .join(', ')}). Set "version" to 4 -- the v3 -> v4 migration would otherwise discard it.`,
    );
  }
  return { ...doc, version: 4, npcs: [], triggers: [], events: {}, worldSeeds: {} };
}

registerMigration(3, migrateV3ToV4);

/**
 * v4 -> v5 lossless wrap (depth-props-hd design, C5 WU-01): a v4 document had
 * no props collection and no tileset tile-pixel-size, so migration adds an
 * EMPTY `props` array, stamps `tileset.tilePixelSize = 48` (RPG Maker
 * standard), and bumps `version` -- every other field passes through
 * unmodified via the spread, exactly like `migrateV3ToV4`.
 *
 * A document that already carries either v5 field while still declaring
 * `version: 4` would migrate "successfully" with authored props or a custom
 * tilePixelSize silently discarded -- fail LOUDLY instead, naming the keys
 * found. Absent keys stay the ordinary v4 case and keep migrating.
 */
export function migrateV4ToV5(doc: Record<string, unknown>): Record<string, unknown> {
  const carried: string[] = [];
  if (doc.props !== undefined) carried.push('props');
  const tileset = doc.tileset;
  if (
    typeof tileset === 'object' &&
    tileset !== null &&
    (tileset as Record<string, unknown>).tilePixelSize !== undefined
  ) {
    carried.push('tilePixelSize');
  }
  if (carried.length > 0) {
    throw new MapFormatError(
      'malformed',
      `Map document declares "version": 4 but already carries v5 content (${carried
        .map((key) => JSON.stringify(key))
        .join(', ')}). Set "version" to 5 -- the v4 -> v5 migration would otherwise discard it.`,
    );
  }

  const nextTileset =
    typeof tileset === 'object' && tileset !== null
      ? { ...(tileset as Record<string, unknown>), tilePixelSize: 48 }
      : tileset;

  return { ...doc, version: 5, props: [], tileset: nextTileset };
}

registerMigration(4, migrateV4ToV5);

/**
 * v5 -> v6 lossless wrap (lighting design, C6 WU-01): a v5 document had no
 * lights collection and no per-floor lightMap, so migration adds an EMPTY
 * `lights` array and bumps `version` -- every other field passes through
 * unmodified via the spread, exactly like `migrateV4ToV5`.
 *
 * A document that already carries top-level `lights` or any floor's
 * `lightMap` while still declaring `version: 5` would migrate "successfully"
 * with authored lighting content silently discarded -- fail LOUDLY instead,
 * naming the keys found. Absent keys stay the ordinary v5 case and keep
 * migrating.
 */
export function migrateV5ToV6(doc: Record<string, unknown>): Record<string, unknown> {
  const carried: string[] = [];
  if (doc.lights !== undefined) carried.push('lights');
  const floors = doc.floors;
  if (Array.isArray(floors)) {
    for (const floor of floors) {
      if (
        typeof floor === 'object' &&
        floor !== null &&
        (floor as Record<string, unknown>).lightMap !== undefined
      ) {
        carried.push('lightMap');
        break;
      }
    }
  }
  if (carried.length > 0) {
    throw new MapFormatError(
      'malformed',
      `Map document declares "version": 5 but already carries v6 content (${carried
        .map((key) => JSON.stringify(key))
        .join(', ')}). Set "version" to 6 -- the v5 -> v6 migration would otherwise discard it.`,
    );
  }

  return { ...doc, version: 6, lights: [] };
}

registerMigration(5, migrateV5ToV6);

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
