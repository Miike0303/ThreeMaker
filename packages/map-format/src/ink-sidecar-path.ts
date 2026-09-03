/**
 * Ink sidecar path convention beside a map document:
 * `<mapBase>.tmmap.json` → `<mapBase>.<storyId>.ink`
 *
 * Shared by editor, MCP, desktop Play, and the vite dev map API so the
 * charset gate and path formula cannot drift.
 */

/** Suffix an authored map file carries; the sidecar base is the path without it. */
export const MAP_DOCUMENT_FILE_SUFFIX = '.tmmap.json';

/**
 * Story ids safe to interpolate into a sidecar file name: letters, digits,
 * `_` or `-` only. A `.tmmap` is untrusted input; without this gate a
 * document-supplied `storyId` like `"../../../evil"` would address outside
 * the maps directory.
 */
export const SAFE_STORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isSafeStoryId(storyId: string): boolean {
  return SAFE_STORY_ID_PATTERN.test(storyId);
}

/**
 * Home- or project-relative path for one story's `.ink` sidecar.
 * Throws when `storyId` is not path-safe.
 */
export function inkSidecarRelativePath(mapRelativePath: string, storyId: string): string {
  if (!isSafeStoryId(storyId)) {
    throw new Error(
      `Ink story id ${JSON.stringify(storyId)} is not path-safe (letters, digits, "_" and "-" only).`,
    );
  }
  const base = mapRelativePath.endsWith(MAP_DOCUMENT_FILE_SUFFIX)
    ? mapRelativePath.slice(0, -MAP_DOCUMENT_FILE_SUFFIX.length)
    : mapRelativePath;
  return `${base}.${storyId}.ink`;
}
