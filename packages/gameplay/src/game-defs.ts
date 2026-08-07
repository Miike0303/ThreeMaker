/**
 * Data-driven item and stat definitions document (PLAN_DEV_2 C4).
 *
 * Magic + version like `packages/save` documents; loud hand-written
 * validation (throws) like `apps/desktop/src/game-manifest.ts`.
 */

export const GAME_DEFS_MAGIC = 'threemaker.game-defs' as const;
export const CURRENT_GAME_DEFS_VERSION = 1 as const;

export type ItemDefinition = {
  id: string;
  name: string;
};

export type StatDefinition = {
  id: string;
  name: string;
  base: number;
  min: number;
  max: number;
};

export type GameDefsDocument = {
  magic: typeof GAME_DEFS_MAGIC;
  version: typeof CURRENT_GAME_DEFS_VERSION;
  items: ItemDefinition[];
  stats: StatDefinition[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseItem(entry: unknown, index: number): ItemDefinition {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`Invalid game-defs items[${index}]: expected an object.`);
  }
  const record = entry as Record<string, unknown>;
  if (!isNonEmptyString(record.id)) {
    throw new Error(`Invalid game-defs items[${index}].id: expected a non-empty string.`);
  }
  if (!isNonEmptyString(record.name)) {
    throw new Error(`Invalid game-defs items[${index}].name: expected a non-empty string.`);
  }
  return { id: record.id, name: record.name };
}

function parseStat(entry: unknown, index: number): StatDefinition {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`Invalid game-defs stats[${index}]: expected an object.`);
  }
  const record = entry as Record<string, unknown>;
  if (!isNonEmptyString(record.id)) {
    throw new Error(`Invalid game-defs stats[${index}].id: expected a non-empty string.`);
  }
  if (!isNonEmptyString(record.name)) {
    throw new Error(`Invalid game-defs stats[${index}].name: expected a non-empty string.`);
  }
  if (!isFiniteNumber(record.base)) {
    throw new Error(`Invalid game-defs stats[${index}].base: expected a finite number.`);
  }
  if (!isFiniteNumber(record.min)) {
    throw new Error(`Invalid game-defs stats[${index}].min: expected a finite number.`);
  }
  if (!isFiniteNumber(record.max)) {
    throw new Error(`Invalid game-defs stats[${index}].max: expected a finite number.`);
  }
  if (record.min > record.max) {
    throw new Error(
      `Invalid game-defs stats[${index}]: min (${record.min}) > max (${record.max}).`,
    );
  }
  if (record.base < record.min || record.base > record.max) {
    throw new Error(
      `Invalid game-defs stats[${index}].base: ${record.base} is outside [${record.min}, ${record.max}].`,
    );
  }
  return {
    id: record.id,
    name: record.name,
    base: record.base,
    min: record.min,
    max: record.max,
  };
}

function assertNoDuplicateIds(kind: 'item' | 'stat', entries: ReadonlyArray<{ id: string }>): void {
  const firstIndexById = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const prior = firstIndexById.get(entry.id);
    if (prior !== undefined) {
      throw new Error(
        `Invalid game-defs: duplicate ${kind} id ${JSON.stringify(entry.id)} at indexes ${prior} and ${index}.`,
      );
    }
    firstIndexById.set(entry.id, index);
  }
}

/**
 * Validate a decoded JSON value as a game-defs document.
 * Throws with a message naming the offending field/index on any violation.
 */
export function parseGameDefs(raw: unknown): GameDefsDocument {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Invalid game-defs: expected an object.');
  }
  const record = raw as Record<string, unknown>;

  if (record.magic !== GAME_DEFS_MAGIC) {
    throw new Error(
      `Invalid game-defs magic: expected ${JSON.stringify(GAME_DEFS_MAGIC)}, got ${JSON.stringify(record.magic)}.`,
    );
  }
  if (record.version !== CURRENT_GAME_DEFS_VERSION) {
    throw new Error(
      `Invalid game-defs version: expected ${CURRENT_GAME_DEFS_VERSION}, got ${JSON.stringify(record.version)}.`,
    );
  }
  if (!Array.isArray(record.items)) {
    throw new Error('Invalid game-defs items: expected an array.');
  }
  if (!Array.isArray(record.stats)) {
    throw new Error('Invalid game-defs stats: expected an array.');
  }

  const items = record.items.map((entry, index) => parseItem(entry, index));
  const stats = record.stats.map((entry, index) => parseStat(entry, index));

  assertNoDuplicateIds('item', items);
  assertNoDuplicateIds('stat', stats);

  return {
    magic: GAME_DEFS_MAGIC,
    version: CURRENT_GAME_DEFS_VERSION,
    items,
    stats,
  };
}

/** JSON.parse + {@link parseGameDefs}; wraps syntax errors in a clear message. */
export function parseGameDefsJson(text: string): GameDefsDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid game-defs JSON: ${detail}`);
  }
  return parseGameDefs(raw);
}
