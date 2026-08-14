/**
 * Pure runtime shape the host fills when saving / applies when loading.
 * No DOM, no WorldState class — plain data so tests stay node-only.
 */

/** Same value set as `@threemaker/core` WorldValue (kept local to avoid a dep for a pure document package). */
export type SaveWorldValue = boolean | number | string;

export type SaveFacing = 'up' | 'down' | 'left' | 'right';

/**
 * Session progress the desktop runtime can read/write today (v3).
 *
 * - `mapFile` — path relative to `.threemaker/maps` (manifest entry file, or
 *   `current.tmmap.json` in single-file mode). Stable across index reshuffles.
 * - `floor` — runtime floor **index** into the loaded map's floors array
 *   (same convention as GridMover / TriggerIndex / NPC registry).
 * - `world` — full snapshot of session-scoped narrative keys (cross-map
 *   WorldState). Event "flags" in this engine are world keys, not a separate
 *   store.
 * - `inventory` — positive item counts only (zeros dropped at capture).
 * - `stats` — finite stat values keyed by session def ids.
 * - `stories` — ink `story.state.ToJson()` strings keyed by `storyId`.
 */
export type GameSaveSnapshot = {
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly facing: SaveFacing;
  readonly world: Readonly<Record<string, SaveWorldValue>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly stats: Readonly<Record<string, number>>;
  readonly stories: Readonly<Record<string, string>>;
};
