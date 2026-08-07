/**
 * Versioned game-save document (PLAN_DEV_2 C3/C4).
 *
 * Same spirit as `map-format/migrate.ts` and C2 `bindings-document.ts`:
 * magic + integer version, validate before use, unknown/malformed payloads
 * fail closed without throwing. I/O stays in the host.
 *
 * v1 was player + world only. v2 adds inventory + stats (C4); older files
 * migrate via {@link migrateV1ToV2} registered in `migrate.ts`.
 */

import { CURRENT_GAME_SAVE_VERSION, GAME_SAVE_MAGIC } from './constants.js';
import { migrateSaveDocumentToCurrent } from './migrate.js';
import type { GameSaveSnapshot, SaveFacing, SaveWorldValue } from './types.js';

export { CURRENT_GAME_SAVE_VERSION, GAME_SAVE_MAGIC } from './constants.js';

export type GameSavePlayerV1 = {
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly facing: SaveFacing;
};

/** On-disk / wire shape at version 1 (C3). Kept for migration typing. */
export type GameSaveDocumentV1 = {
  readonly magic: typeof GAME_SAVE_MAGIC;
  readonly version: 1;
  readonly player: GameSavePlayerV1;
  readonly world: Readonly<Record<string, SaveWorldValue>>;
};

/** On-disk / wire shape at version 2 (C4): inventory + stats beside world. */
export type GameSaveDocumentV2 = {
  readonly magic: typeof GAME_SAVE_MAGIC;
  readonly version: 2;
  readonly player: GameSavePlayerV1;
  readonly world: Readonly<Record<string, SaveWorldValue>>;
  /** Positive item counts only (zeros invalid at parse; dropped at capture). */
  readonly inventory: Readonly<Record<string, number>>;
  /** Finite stat values keyed by session def ids. */
  readonly stats: Readonly<Record<string, number>>;
};

/** Alias for the current schema generation. */
export type GameSaveDocument = GameSaveDocumentV2;

export type GameSaveParseOk = {
  readonly ok: true;
  readonly version: number;
  readonly document: GameSaveDocument;
};

export type GameSaveParseFail = {
  readonly ok: false;
  readonly reason: string;
};

export type GameSaveParseResult = GameSaveParseOk | GameSaveParseFail;

const FACINGS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isSaveWorldValue(value: unknown): value is SaveWorldValue {
  const t = typeof value;
  return t === 'boolean' || t === 'number' || t === 'string';
}

function parsePlayer(raw: unknown): GameSavePlayerV1 | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.mapFile)) return undefined;
  if (!isInteger(record.x) || !isInteger(record.y) || !isInteger(record.floor)) {
    return undefined;
  }
  if (record.floor < 0) return undefined;
  if (typeof record.facing !== 'string' || !FACINGS.has(record.facing)) return undefined;
  return {
    mapFile: record.mapFile,
    x: record.x,
    y: record.y,
    floor: record.floor,
    facing: record.facing as SaveFacing,
  };
}

function parseWorld(raw: unknown): Record<string, SaveWorldValue> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, SaveWorldValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) return undefined;
    if (!isSaveWorldValue(value)) return undefined;
    // Numbers must be finite (no NaN/Infinity in saves).
    if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
    out[key] = value;
  }
  return out;
}

/**
 * Positive integer counts only. Zeros are invalid on-disk (dropped at capture);
 * non-integers / negatives fail closed.
 */
function parseInventory(raw: unknown): Record<string, number> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
    out[key] = value;
  }
  return out;
}

/** Finite numbers only (no NaN/Infinity). */
function parseStats(raw: unknown): Record<string, number> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(key)) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    out[key] = value;
  }
  return out;
}

/**
 * Validate a decoded JSON value as a game-save document.
 * Never throws — invalid input yields `{ ok: false }`.
 *
 * Older known versions are migrated via {@link migrateSaveDocumentToCurrent}
 * (registry pattern matching map-format). Versions newer than CURRENT fail closed.
 */
export function parseGameSaveDocument(raw: unknown): GameSaveParseResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'document must be an object' };
  }
  const record = raw as Record<string, unknown>;
  if (record.magic !== GAME_SAVE_MAGIC) {
    return { ok: false, reason: 'missing or invalid magic' };
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version)) {
    return { ok: false, reason: 'version must be an integer' };
  }

  const migrated = migrateSaveDocumentToCurrent(record);
  if (!migrated.ok) {
    return { ok: false, reason: migrated.reason };
  }

  const player = parsePlayer(migrated.raw.player);
  if (player === undefined) {
    return { ok: false, reason: 'invalid player' };
  }
  const world = parseWorld(migrated.raw.world);
  if (world === undefined) {
    return { ok: false, reason: 'invalid world' };
  }
  const inventory = parseInventory(migrated.raw.inventory);
  if (inventory === undefined) {
    return { ok: false, reason: 'invalid inventory' };
  }
  const stats = parseStats(migrated.raw.stats);
  if (stats === undefined) {
    return { ok: false, reason: 'invalid stats' };
  }

  return {
    ok: true,
    version: CURRENT_GAME_SAVE_VERSION,
    document: {
      magic: GAME_SAVE_MAGIC,
      version: CURRENT_GAME_SAVE_VERSION,
      player,
      world,
      inventory,
      stats,
    },
  };
}

/** Serialize a validated document as JSON text. */
export function serializeGameSaveDocument(document: GameSaveDocument): string {
  return JSON.stringify(document);
}

/** Convenience: parse JSON text (or null) without throwing. */
export function parseGameSaveJson(text: string | null): GameSaveParseResult {
  if (text === null || text.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'invalid json' };
  }
  return parseGameSaveDocument(raw);
}

/** Type guard helper for hosts that only need a snapshot after a successful parse. */
export function isGameSaveParseOk(result: GameSaveParseResult): result is GameSaveParseOk {
  return result.ok;
}

// Re-export snapshot field type for hosts building documents by hand in tests.
export type { GameSaveSnapshot };
