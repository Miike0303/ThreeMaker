/**
 * MZ project marker (`game.rmmzproject`) resolution.
 *
 * Design's Open Question: only the FORMAT is verified (one line, lowercase
 * filename, `RPGMZ <version>`); the actual version string an export should
 * ship is NOT independently derivable (RPGMZ.exe exposes no readable version
 * resource, and the marker's own version scheme -- observed `0.9.4`/`0.9.5`
 * across real installed DLC sample projects -- does not match any exposed
 * corescript/engine version number). Resolution path (design's (a)):
 * prefer a cheaply-detected real value read from an existing marker file
 * under the installed engine directory (see `node.ts`'s
 * `findInstalledMarkerVersion`, which performs the actual bounded-depth
 * filesystem search); fall back to the empirically-observed
 * format-compatible value otherwise. The value is only considered CLOSED
 * once the real-MZ acceptance test (ladder step 3) confirms it opens.
 */

export const MARKER_FILE_NAME = 'game.rmmzproject';

/** Empirically observed in `C:\Games\RPG Maker MZ\dlc\3D Particle Effect Pack\sample_project\game.rmmzproject` -- format-compatible, not independently derived from any engine version resource. */
export const EMPIRICAL_FALLBACK_MARKER = 'RPGMZ 0.9.4';

const MARKER_LINE_PATTERN = /^RPGMZ \d+\.\d+\.\d+$/;

/** True only for the exact `RPGMZ x.y.z` format observed across real installed marker files. */
export function isValidMarkerLine(line: string): boolean {
  return MARKER_LINE_PATTERN.test(line);
}

/** The marker file's exact byte contents: the version line, no trailing newline (matches every real sample observed). */
export function buildMarkerFileContents(version: string): string {
  return version;
}

/**
 * Resolves the marker value to ship in an export. `detected` is whatever a
 * cheap installed-engine lookup found (or `null`/invalid) -- this function
 * itself does no filesystem IO (see `node.ts` for that), so it stays pure
 * and unit-testable without touching disk.
 */
export function resolveMarkerValue(detected: string | null): string {
  if (detected !== null && isValidMarkerLine(detected)) return detected;
  return EMPIRICAL_FALLBACK_MARKER;
}
