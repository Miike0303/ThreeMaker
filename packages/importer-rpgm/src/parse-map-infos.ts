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

/**
 * Sidebar order: roots (`parentId` 0), siblings by `order` then `id`, parent
 * before its children. The visited set stops cycles. Entries the walk never
 * reaches (missing parent or a cycle off the roots) are appended, sorted by `id`.
 */
export function orderMapInfosByTree(infos: readonly RpgmMapInfo[]): RpgmMapInfo[] {
  const childrenByParent = new Map<number, RpgmMapInfo[]>();
  for (const info of infos) {
    const siblings = childrenByParent.get(info.parentId);
    if (siblings) siblings.push(info);
    else childrenByParent.set(info.parentId, [info]);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.order - b.order || a.id - b.id);
  }

  const visited = new Set<RpgmMapInfo>();
  const ordered: RpgmMapInfo[] = [];
  const walk = (info: RpgmMapInfo): void => {
    if (visited.has(info)) return;
    visited.add(info);
    ordered.push(info);
    const children = childrenByParent.get(info.id);
    if (!children) return;
    for (const child of children) walk(child);
  };
  for (const root of childrenByParent.get(0) ?? []) walk(root);

  const unreached = infos.filter((info) => !visited.has(info));
  unreached.sort((a, b) => a.id - b.id);
  ordered.push(...unreached);
  return ordered;
}
