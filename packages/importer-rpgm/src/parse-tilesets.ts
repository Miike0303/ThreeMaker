import type { TileSheetId } from './tile-id.js';
import type { RpgmTileset, TileSheetNames } from './types.js';

// Order of `tilesetNames` in Tilesets.json: [A1, A2, A3, A4, A5, B, C, D, E].
const SHEET_NAME_ORDER: readonly TileSheetId[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];

/**
 * Parses `Tilesets.json`. Like `MapInfos.json`, the raw file is a 1-indexed
 * sparse array with a `null` placeholder at index 0; this returns a dense
 * array of only the real entries.
 */
export function parseTilesets(json: unknown): RpgmTileset[] {
  if (!Array.isArray(json)) {
    throw new Error('Invalid Tilesets.json: expected an array.');
  }

  const tilesets: RpgmTileset[] = [];
  for (const entry of json) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry !== 'object') {
      throw new Error(`Invalid Tilesets.json entry: expected an object, got ${typeof entry}.`);
    }

    const { id, name, flags, tilesetNames } = entry as Record<string, unknown>;
    if (typeof id !== 'number' || typeof name !== 'string') {
      throw new Error(
        `Invalid Tilesets.json entry: missing "id"/"name" in ${JSON.stringify(entry).slice(0, 200)}`,
      );
    }
    if (!Array.isArray(flags) || !flags.every((value) => typeof value === 'number')) {
      throw new Error(`Invalid Tilesets.json entry ${id}: "flags" must be an array of numbers.`);
    }
    if (!Array.isArray(tilesetNames) || tilesetNames.length !== SHEET_NAME_ORDER.length) {
      throw new Error(
        `Invalid Tilesets.json entry ${id}: "tilesetNames" must have exactly ${SHEET_NAME_ORDER.length} entries.`,
      );
    }

    if (!tilesetNames.every((value) => typeof value === 'string')) {
      throw new Error(
        `Invalid Tilesets.json entry ${id}: "tilesetNames" must contain only strings.`,
      );
    }
    const sheetNames = {} as Record<TileSheetId, string>;
    SHEET_NAME_ORDER.forEach((sheet, index) => {
      sheetNames[sheet] = tilesetNames[index];
    });

    tilesets.push({
      id,
      name,
      sheetNames: sheetNames as TileSheetNames,
      flags: flags as readonly number[],
    });
  }
  return tilesets;
}
