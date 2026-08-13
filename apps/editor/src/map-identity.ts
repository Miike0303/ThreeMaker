/**
 * Named-map identity (WU-B). Map names become filenames under
 * `.threemaker/maps/{name}.tmmap.json`. Pure: no I/O.
 *
 * Legacy `current.tmmap.json` is a normal map named `current` — adopted in
 * place so existing files and `current.<storyId>.ink` sidecars stay put.
 */

export const MAP_DIR_RELATIVE = '.threemaker/maps';
export const MAP_FILE_SUFFIX = '.tmmap.json';
export const INK_FILE_SUFFIX = '.ink';
export const LEGACY_MAP_NAME = 'current';
export const MAP_NAME_MAX_LENGTH = 64;

const SAFE_STORY_ID = /^[A-Za-z0-9_-]+$/;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;
const ILLEGAL_FILENAME_CHARS = /[<>:"|?*]/;

function hasControlChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export type MapNameIssue =
  | 'empty'
  | 'too-long'
  | 'invalid-chars'
  | 'dot-dot'
  | 'absolute'
  | 'reserved';

export class InvalidMapNameError extends Error {
  readonly issue: MapNameIssue;

  constructor(issue: MapNameIssue, name: string) {
    super(`Invalid map name ${JSON.stringify(name)} (${issue})`);
    this.name = 'InvalidMapNameError';
    this.issue = issue;
  }
}

/** `null` when `raw` is a usable map stem (after trim). */
export function validateMapName(raw: string): MapNameIssue | null {
  const name = raw.trim();
  if (name.length === 0) return 'empty';
  if (name.length > MAP_NAME_MAX_LENGTH) return 'too-long';
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    return 'absolute';
  }
  if (name === '.' || name.includes('..')) return 'dot-dot';
  if (
    /[/\\]/.test(name) ||
    ILLEGAL_FILENAME_CHARS.test(name) ||
    hasControlChar(name) ||
    name.endsWith('.')
  ) {
    return 'invalid-chars';
  }
  if (WINDOWS_RESERVED.test(name)) return 'reserved';
  return null;
}

/** Trimmed valid stem, or throws {@link InvalidMapNameError}. */
export function assertMapName(raw: string): string {
  const name = raw.trim();
  const issue = validateMapName(name);
  if (issue !== null) throw new InvalidMapNameError(issue, raw);
  return name;
}

export function mapDocumentFileName(name: string): string {
  return `${assertMapName(name)}${MAP_FILE_SUFFIX}`;
}

/**
 * ASCII case-fold for filename identity. Not locale collation — these are
 * filenames, and Windows treats `town` and `TOWN` as the same file.
 */
export function foldMapFileName(value: string): string {
  return value.toLowerCase();
}

export function mapFileNamesEqual(a: string, b: string): boolean {
  return foldMapFileName(a) === foldMapFileName(b);
}

/** Saved stem that collides with `candidate` case-insensitively, if any. */
export function collidingSavedMapName(
  candidate: string,
  savedNames: readonly string[],
): string | undefined {
  const folded = foldMapFileName(candidate.trim());
  if (folded.length === 0) return undefined;
  return savedNames.find((saved) => foldMapFileName(saved) === folded);
}

/** Directory entry for an existing map document that matches `name` ignoring case. */
export function existingMapDocumentFileName(
  name: string,
  entries: readonly string[],
): string | undefined {
  const wanted = mapDocumentFileName(name);
  return entries.find(
    (entry) => mapNameFromDocumentFileName(entry) !== null && mapFileNamesEqual(entry, wanted),
  );
}

/** Home-relative path for a named map document. */
export function mapFileRelativePath(name: string): string {
  return `${MAP_DIR_RELATIVE}/${mapDocumentFileName(name)}`;
}

/** Legacy single-file path — `current.tmmap.json`, still a valid named map. */
export const MAP_FILE_RELATIVE = mapFileRelativePath(LEGACY_MAP_NAME);

export function mapNameFromDocumentFileName(fileName: string): string | null {
  if (fileName.includes('/') || fileName.includes('\\')) return null;
  if (!fileName.endsWith(MAP_FILE_SUFFIX)) return null;
  const stem = fileName.slice(0, -MAP_FILE_SUFFIX.length);
  if (validateMapName(stem) !== null) return null;
  return stem;
}

/** Sorted unique valid map stems found among directory entry names. */
export function listMapNamesFromEntries(entries: readonly string[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    const name = mapNameFromDocumentFileName(entry);
    if (name !== null) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function isInkSidecarForMap(fileName: string, mapName: string): boolean {
  const prefix = `${assertMapName(mapName)}.`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith(INK_FILE_SUFFIX)) return false;
  const storyId = fileName.slice(prefix.length, -INK_FILE_SUFFIX.length);
  return SAFE_STORY_ID.test(storyId);
}

export interface MapFileMove {
  readonly from: string;
  readonly to: string;
}

function homeRelative(fileName: string): string {
  return `${MAP_DIR_RELATIVE}/${fileName}`;
}

/**
 * Map document + matching `.ink` sidecars to rename. Throws if `to` already
 * exists as a map document in `entries`.
 */
export function planRenameMapFiles(
  fromRaw: string,
  toRaw: string,
  entries: readonly string[],
): readonly MapFileMove[] {
  const from = assertMapName(fromRaw);
  const to = assertMapName(toRaw);
  if (from === to) return [];
  const existing = existingMapDocumentFileName(to, entries);
  if (existing !== undefined && !mapFileNamesEqual(existing, mapDocumentFileName(from))) {
    throw new Error(`Map ${JSON.stringify(to)} already exists`);
  }
  const moves: MapFileMove[] = [
    {
      from: mapFileRelativePath(from),
      to: mapFileRelativePath(to),
    },
  ];
  for (const entry of entries) {
    if (!isInkSidecarForMap(entry, from)) continue;
    const storyId = entry.slice(`${from}.`.length, -INK_FILE_SUFFIX.length);
    moves.push({
      from: homeRelative(entry),
      to: homeRelative(`${to}.${storyId}${INK_FILE_SUFFIX}`),
    });
  }
  return moves;
}

/** Map document + matching `.ink` sidecars to delete. */
export function planDeleteMapFiles(nameRaw: string, entries: readonly string[]): readonly string[] {
  const name = assertMapName(nameRaw);
  const paths = [mapFileRelativePath(name)];
  for (const entry of entries) {
    if (isInkSidecarForMap(entry, name)) paths.push(homeRelative(entry));
  }
  return paths;
}
