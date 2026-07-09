import type { RpgmMapInfo } from './types.js';

/**
 * Parses `MapInfos.json`. The raw file is a 1-indexed sparse array with a
 * `null` placeholder at index 0 (RPG Maker convention); this returns a dense
 * array of only the real entries.
 */
export function parseMapInfos(json: unknown): RpgmMapInfo[] {
  if (!Array.isArray(json)) {
    throw new Error('Invalid MapInfos.json: expected an array.');
  }

  const infos: RpgmMapInfo[] = [];
  for (const entry of json) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry !== 'object') {
      throw new Error(`Invalid MapInfos.json entry: expected an object, got ${typeof entry}.`);
    }

    const { id, name, parentId, order } = entry as Record<string, unknown>;
    if (
      typeof id !== 'number' ||
      typeof name !== 'string' ||
      typeof parentId !== 'number' ||
      typeof order !== 'number'
    ) {
      throw new Error(`Invalid MapInfos.json entry: ${JSON.stringify(entry)}`);
    }

    infos.push({ id, name, parentId, order });
  }
  return infos;
}
