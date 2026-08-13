/**
 * Ink sidecar path convention — kept in lockstep with
 * `apps/editor/src/ink-sidecar.ts` (`<mapBase>.<storyId>.ink` beside
 * `<mapBase>.tmmap.json`). This copy exists because the editor tree is
 * out of scope for this work unit.
 */

const MAP_FILE_SUFFIX = '.tmmap.json';
const SAFE_STORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Same charset gate the editor uses before building a sidecar path. */
export function isSafeStoryId(storyId: string): boolean {
  return SAFE_STORY_ID_PATTERN.test(storyId);
}

/**
 * Project-relative path for one story's `.ink` sidecar.
 * Throws when `storyId` is not path-safe.
 */
export function inkSidecarRelativePath(mapRelativePath: string, storyId: string): string {
  if (!isSafeStoryId(storyId)) {
    throw new Error(
      `Ink story id ${JSON.stringify(storyId)} is not path-safe (letters, digits, "_" and "-" only).`,
    );
  }
  const base = mapRelativePath.endsWith(MAP_FILE_SUFFIX)
    ? mapRelativePath.slice(0, -MAP_FILE_SUFFIX.length)
    : mapRelativePath;
  return `${base}.${storyId}.ink`;
}
