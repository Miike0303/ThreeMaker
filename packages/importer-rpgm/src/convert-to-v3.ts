/**
 * RPGM -> ThreeMaker map-format v3 converter (rpgm-to-v3-spike: validation
 * spike proving the RPGM-import pipeline, not a production feature). Pure --
 * no fs/network here, mirrors `apps/editor/src/map-compose.ts`'s
 * `toRenderableMap`/`toRenderableTileset` in the OPPOSITE direction (v3 ->
 * RpgmMap there, RpgmMap -> v3 here).
 *
 * `RpgmMap.layers`'s 4 tile layers + shadows + regions are already
 * structurally identical to `MapLayers` (`readonly number[]`, length
 * `width * height`), so the layer copy is a direct 1:1 passthrough -- no
 * transformation needed. Everything this map has no RPGM-native source for
 * (`stairLinks`, `rooms`) comes out empty, matching a freshly-created blank
 * v3 document.
 */

import type { MapDocument, SlotComposition } from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';
import { decodeTileFlags } from './tile-flags.js';
import type { RpgmMap, RpgmTileset } from './types.js';

const FLOOR_ID = 'floor-0';

export interface RpgmPlayerStart {
  readonly x: number;
  readonly y: number;
}

export interface ConvertRpgmMapOptions {
  /** Document id; defaults to `rpgm-map-${map.id}` (or `rpgm-map-unknown` when `map.id` is `null`). */
  readonly id?: string;
  /**
   * RPGM's `System.json` player start position, when this map IS the
   * project's configured start map. Omit for every other map -- the
   * fallback below picks the first passable tile instead.
   */
  readonly playerStart?: RpgmPlayerStart;
  /**
   * Per-slot sheet sourcing, already resolved by the caller (e.g. the
   * `convert-rpgm` CLI's catalog lookup -- see
   * `packages/assets/src/resolve-rpgm-slots.ts`). This pure converter never
   * touches the catalog itself; a slot omitted here is left unsourced,
   * matching the empty-`{}` default and `apps/desktop/src/authored-map.ts`'s
   * per-slot skip for an unsourced slot. Defaults to `{}`.
   */
  readonly slots?: SlotComposition;
}

/**
 * A tile is standable when the topmost non-star (non-upper-layer), non-empty
 * tile across the 4 layers isn't impassable from every direction at once.
 * Deliberately simplified vs. `@threemaker/gameplay`'s `PassabilityGrid`
 * (which also folds in ramp/edge-profile elevation checks): that package
 * already depends on this one (see its `passability-grid.ts`), so importing
 * it back here would be a cycle. Not needed for accuracy either -- this only
 * picks a best-effort authored spawn; the desktop runtime's own
 * `resolveInitialSpawn`/`findSpawnTile` (`apps/desktop/src/spawn.ts`)
 * silently re-validates and re-picks a spawn at load time regardless.
 * ponytail: ceiling is "may authoring a spawn on a ramp/ledge edge case
 * picks a tile the full PassabilityGrid would reject"; upgrade path is
 * hoisting a shared standability primitive into a package neither
 * `gameplay` nor this package needs to import the other for.
 */
function isTileStandable(map: RpgmMap, tileset: RpgmTileset, x: number, y: number): boolean {
  const index = y * map.width + x;
  for (let layerIndex = 3; layerIndex >= 0; layerIndex--) {
    const tileId = map.layers.tileLayers[layerIndex]?.[index] ?? 0;
    if (tileId === 0) continue;

    const flags = decodeTileFlags(tileset.flags[tileId] ?? 0);
    if (flags.isUpperLayer) continue; // star bit: never decides, keep looking below

    return !(
      flags.impassableDown &&
      flags.impassableLeft &&
      flags.impassableRight &&
      flags.impassableUp
    );
  }
  return true; // no decisive tile on any layer: treated as open
}

/** First standable tile in row-major scan order, or `null` if the map has none at all. */
function findFirstStandableTile(map: RpgmMap, tileset: RpgmTileset): RpgmPlayerStart | null {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isTileStandable(map, tileset, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Converts one parsed RPGM map + its matching tileset into a single-floor v3
 * `MapDocument` at `baseElevation` 0. `stairLinks`/`rooms` are always empty
 * (no RPGM-native source for either). `tileset.slots` defaults to `{}` and is
 * otherwise exactly whatever `opts.slots` gives -- this pure converter never
 * touches the catalog itself (see `ConvertRpgmMapOptions.slots`'s doc
 * comment); a slot with no `object` stays unsourced, so
 * `apps/desktop/src/authored-map.ts`'s per-slot resolver simply skips it
 * rather than failing.
 */
export function convertRpgmMap(
  map: RpgmMap,
  tileset: RpgmTileset,
  opts: ConvertRpgmMapOptions = {},
): MapDocument {
  const id = opts.id ?? `rpgm-map-${map.id ?? 'unknown'}`;
  const spawnTile = opts.playerStart ?? findFirstStandableTile(map, tileset);

  const doc: MapDocument = {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id,
    name: map.displayName,
    width: map.width,
    height: map.height,
    tileset: {
      slots: opts.slots ?? {},
      flags: tileset.flags,
      semantics: {},
    },
    floors: [
      {
        id: FLOOR_ID,
        baseElevation: 0,
        layers: {
          tiles: map.layers.tileLayers,
          shadows: map.layers.shadows,
          regions: map.layers.regions,
        },
      },
    ],
    stairLinks: [],
    rooms: [],
  };

  return spawnTile === null
    ? doc
    : { ...doc, spawn: { x: spawnTile.x, y: spawnTile.y, floor: FLOOR_ID } };
}
