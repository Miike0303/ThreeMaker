/**
 * `manifest.json` reader for the batch `convert-rpgm-game` CLI output
 * (rpgm-whole-game-import change) -- mirrors
 * `packages/assets/src/convert-rpgm-game.ts`'s own `GameManifest` shape.
 * Desktop deliberately does NOT depend on `@threemaker/assets` (a Node-only
 * package with `better-sqlite3`, irrelevant to a Tauri bundle) -- this is an
 * independent hand-validated parser over the same plain JSON contract, same
 * convention `@threemaker/map-format`'s own schema validation already uses
 * for `.tmmap` documents.
 *
 * Read via `map-file.ts`'s `readManifestText()`, then parsed here. `main.ts`
 * uses the result to drive multi-map navigation (the 'g' key cycles
 * `maps[]`) and, when `actorSheet` resolves, a real player sprite instead of
 * the canvas-generated placeholder.
 */

export interface ManifestMapEntry {
  readonly mapId: number;
  readonly name: string;
  /** Path relative to `MAP_DIR_RELATIVE` (`.threemaker/maps`), e.g. `"kingdom-of-subversion/map007.tmmap.json"`. */
  readonly file: string;
  readonly slotsResolved: number;
}

export interface ManifestActorSheet {
  /** Content-addressed sha256 of the lead actor's character sheet PNG. */
  readonly object: string;
  /** Which of the sheet's 8 character blocks (4 cols x 2 rows) the player sprite uses, 0-indexed. */
  readonly characterIndex: number;
}

export interface GameManifest {
  readonly maps: readonly ManifestMapEntry[];
  /** Game-level, not per-map -- the player's own sprite doesn't change per map. Absent when the batch conversion had no `--store` catalog or couldn't resolve the game's lead actor sheet (fail-soft: caller falls back to the placeholder sprite). */
  readonly actorSheet?: ManifestActorSheet;
}

function parseMapEntry(entry: unknown, index: number): ManifestMapEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid manifest entry at index ${index}: expected an object.`);
  }
  const { mapId, name, file, slotsResolved } = entry as Record<string, unknown>;
  if (
    typeof mapId !== 'number' ||
    typeof name !== 'string' ||
    typeof file !== 'string' ||
    typeof slotsResolved !== 'number'
  ) {
    throw new Error(`Invalid manifest entry at index ${index}: ${JSON.stringify(entry)}`);
  }
  return { mapId, name, file, slotsResolved };
}

function parseActorSheet(value: unknown): ManifestActorSheet {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid manifest actorSheet: expected an object.');
  }
  const { object, characterIndex } = value as Record<string, unknown>;
  if (typeof object !== 'string' || typeof characterIndex !== 'number') {
    throw new Error(`Invalid manifest actorSheet: ${JSON.stringify(value)}`);
  }
  return { object, characterIndex };
}

/**
 * Validates and parses a manifest's already-`JSON.parse`d value. Throws
 * (with a descriptive message) on any shape violation -- `main.ts` catches
 * this the same way `authored-map.ts` catches a `.tmmap` parse/validation
 * failure, logging and falling back to the single-file authored-map path.
 */
export function parseGameManifest(json: unknown): GameManifest {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid manifest: expected an object.');
  }
  const { maps, actorSheet } = json as Record<string, unknown>;
  if (!Array.isArray(maps)) {
    throw new Error('Invalid manifest: "maps" must be an array.');
  }

  const parsedMaps = maps.map((entry, index) => parseMapEntry(entry, index));

  return {
    maps: parsedMaps,
    ...(actorSheet !== undefined ? { actorSheet: parseActorSheet(actorSheet) } : {}),
  };
}
