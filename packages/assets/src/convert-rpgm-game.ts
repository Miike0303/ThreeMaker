// Batch conversion: every map in an RPG Maker MV/MZ project -> map-format v3
// `.tmmap` documents, for the `convert-rpgm-game` CLI command
// (rpgm-whole-game-import change). Deliberately reuses `convert-rpgm`'s own
// per-map conversion (`convertSingleRpgmMap`, extracted from `cli.ts`'s
// former `runConvertRpgm` body) rather than re-deriving it -- this module is
// the loop + manifest, not new conversion logic.
import type { RpgmProject } from '@threemaker/importer-rpgm';
import { convertRpgmMap } from '@threemaker/importer-rpgm';
import type { MapDocument, SlotComposition } from '@threemaker/map-format';
import { validateCurrentVersionShape } from '@threemaker/map-format';
import type { Catalog } from './catalog.js';
import { resolveRpgmSlotsFromCatalog } from './resolve-rpgm-slots.js';
import type { RpgmSystemStart } from './rpgm-system.js';

export interface ConvertRpgmMapOptions {
  /** When provided, tileset slots are resolved from this catalog (fail-soft: an unmatched game/tileset simply leaves every slot unsourced, same as omitting `catalog` entirely). */
  readonly catalog?: Catalog;
  /** When provided and its `mapId` matches the map being converted, that map's authored spawn becomes the RPGM player-start tile; every other map gets no authored spawn at all (spawn-quality bug fix, rpgm-whole-game-import) -- the desktop runtime's own center-out `findSpawnTile` search picks a better position at load time than this pure converter could. */
  readonly systemStart?: RpgmSystemStart;
}

export interface ConvertedMap {
  readonly mapId: number;
  readonly doc: MapDocument;
  readonly slotsResolved: number;
  readonly isStartMap: boolean;
}

function zeroPad3(id: number): string {
  return String(id).padStart(3, '0');
}

/**
 * Converts a single map by its RPGM numeric id (same conversion `cli.ts`'s
 * `convert-rpgm` command performs) -- extracted here so both the single-map
 * command and `convertRpgmGame`'s batch loop call the exact same code path,
 * never two independently-maintained copies of "convert one RPGM map".
 * Throws on a missing map or an unresolvable tilesetId; `convertRpgmGame`
 * catches that per-map, `cli.ts`'s single-map command lets it propagate.
 */
export function convertSingleRpgmMap(
  project: RpgmProject,
  mapId: number,
  gameDir: string,
  options: ConvertRpgmMapOptions = {},
): ConvertedMap {
  const map = project.maps.get(mapId);
  if (!map) {
    throw new Error(`no Map${zeroPad3(mapId)}.json found under "${gameDir}".`);
  }
  const tileset = project.tilesets.find((entry) => entry.id === map.tilesetId);
  if (!tileset) {
    throw new Error(
      `map ${mapId} references tilesetId ${map.tilesetId}, which was not found in Tilesets.json.`,
    );
  }

  // [--store] catalog-backed slot wiring: fail-soft, same convention as
  // `cli.ts`'s single-map command -- a missing/unreadable catalog never
  // aborts the conversion, it just leaves every slot unsourced.
  let slots: SlotComposition = {};
  if (options.catalog) {
    slots = resolveRpgmSlotsFromCatalog(options.catalog, gameDir, tileset.id);
  }

  const isStartMap = options.systemStart?.mapId === mapId;
  const playerStart = isStartMap
    ? { x: options.systemStart?.x ?? 0, y: options.systemStart?.y ?? 0 }
    : undefined;

  const doc = convertRpgmMap(map, tileset, {
    id: `rpgm-map-${mapId}`,
    slots,
    ...(playerStart ? { playerStart } : {}),
  });

  validateCurrentVersionShape(doc);

  return { mapId, doc, slotsResolved: Object.keys(slots).length, isStartMap };
}

export interface GameManifestMapEntry {
  readonly mapId: number;
  readonly name: string;
  readonly file: string;
  readonly slotsResolved: number;
}

export interface GameManifestActorSheet {
  /** Content-addressed sha256 of the lead actor's character sheet PNG. */
  readonly object: string;
  /** Which of the sheet's 8 character blocks (4 cols x 2 rows) the player sprite uses, 0-indexed. */
  readonly characterIndex: number;
}

/**
 * `manifest.json` written by `convert-rpgm-game` alongside every converted
 * map file -- read by the desktop app's `game-manifest.ts` to drive
 * multi-map navigation and (when `actorSheet` resolves) a real player
 * sprite instead of the canvas-generated placeholder. Deliberately
 * game-level, not per-map: the player's own sprite doesn't change per map.
 */
export interface GameManifest {
  readonly maps: readonly GameManifestMapEntry[];
  readonly actorSheet?: GameManifestActorSheet;
}

export interface FailedMapEntry {
  readonly mapId: number;
  readonly message: string;
}

export interface ConvertRpgmGameResult {
  /** One entry per successfully converted map, in the order they should be written/listed in the manifest. */
  readonly converted: readonly (GameManifestMapEntry & { readonly doc: MapDocument })[];
  /** Maps that failed to convert (fail-soft, per-map try/catch) -- never aborts the rest of the game. */
  readonly failed: readonly FailedMapEntry[];
}

function mapFileName(mapId: number): string {
  return `map${zeroPad3(mapId)}.tmmap.json`;
}

/**
 * Determines conversion order: `MapInfos.json`'s own tree order (the
 * editor's map-list order), filtered to only ids that actually have a parsed
 * `MapXXX.json` file (per `loadProject`'s own "only maps present on disk"
 * contract), followed by any parsed maps NOT listed in `MapInfos.json` at
 * all (a stale/incomplete map tree), sorted ascending by id -- so every
 * parsed map file is always converted, even one the tree itself doesn't
 * know about.
 */
function orderedMapIds(project: RpgmProject): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const info of project.mapInfos) {
    if (project.maps.has(info.id) && !seen.has(info.id)) {
      ordered.push(info.id);
      seen.add(info.id);
    }
  }
  const remaining = [...project.maps.keys()].filter((id) => !seen.has(id)).sort((a, b) => a - b);
  return [...ordered, ...remaining];
}

/**
 * Converts every map in `project` (in `orderedMapIds` order), one call to
 * `convertSingleRpgmMap` per map, isolating each map's failure from the
 * rest (same per-item error-isolation convention as `cli.ts`'s
 * `runCatalog`/`ingestGame` loop) -- a single unparseable/misreferenced map
 * never aborts the whole game's conversion.
 */
export function convertRpgmGame(
  project: RpgmProject,
  gameDir: string,
  options: ConvertRpgmMapOptions = {},
): ConvertRpgmGameResult {
  const converted: (GameManifestMapEntry & { readonly doc: MapDocument })[] = [];
  const failed: FailedMapEntry[] = [];

  for (const mapId of orderedMapIds(project)) {
    try {
      const result = convertSingleRpgmMap(project, mapId, gameDir, options);
      converted.push({
        mapId,
        name: result.doc.name,
        file: mapFileName(mapId),
        slotsResolved: result.slotsResolved,
        doc: result.doc,
      });
    } catch (err) {
      failed.push({ mapId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { converted, failed };
}
