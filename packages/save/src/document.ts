/**
 * Versioned game-save document (PLAN_DEV_2 C3).
 *
 * Same spirit as `map-format/migrate.ts` and C2 `bindings-document.ts`:
 * magic + integer version, validate before use, unknown/malformed payloads
 * fail closed without throwing. I/O stays in the host.
 *
 * v1 is intentionally small so C4 can add inventory/stats via a v1→v2
 * migration later without rewriting the player/world fields.
 */

import type { GameSaveSnapshot, SaveFacing, SaveWorldValue } from './types.js';

export const GAME_SAVE_MAGIC = 'threemaker.game-save' as const;
export const CURRENT_GAME_SAVE_VERSION = 1 as const;

export type GameSavePlayerV1 = {
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly facing: SaveFacing;
};

/** On-disk / wire shape at version 1. */
export type GameSaveDocumentV1 = {
  readonly magic: typeof GAME_SAVE_MAGIC;
  readonly version: 1;
  readonly player: GameSavePlayerV1;
  readonly world: Readonly<Record<string, SaveWorldValue>>;
};

/** Alias for the current schema generation. */
export type GameSaveDocument = GameSaveDocumentV1;

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
 * Validate a decoded JSON value as a game-save document.
 * Never throws — invalid input yields `{ ok: false }`.
 *
 * Only the current version is accepted in WU-01; a migration loop for older
 * versions lands when a second schema version exists (same registry pattern
 * as map-format).
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
  if (record.version !== CURRENT_GAME_SAVE_VERSION) {
    return { ok: false, reason: `unknown or unsupported version ${record.version}` };
  }

  const player = parsePlayer(record.player);
  if (player === undefined) {
    return { ok: false, reason: 'invalid player' };
  }
  const world = parseWorld(record.world);
  if (world === undefined) {
    return { ok: false, reason: 'invalid world' };
  }

  return {
    ok: true,
    version: record.version,
    document: {
      magic: GAME_SAVE_MAGIC,
      version: 1,
      player,
      world,
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
