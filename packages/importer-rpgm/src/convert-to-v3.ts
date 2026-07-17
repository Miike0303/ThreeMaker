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
   * project's configured start map. Omit for every other map -- no spawn
   * is authored at all (spawn-quality bug fix, rpgm-whole-game-import): a
   * row-major/first-standable-tile scan here has no way to know whether
   * that tile is actually reachable (not enclosed by walls, not off in a
   * visually-inside-a-structure corner) -- the desktop runtime's own
   * `resolveInitialSpawn`/`findSpawnTile` (`apps/desktop/src/spawn.ts`)
   * already does a center-out search with a strengthened "has a usable
   * exit" predicate, and picks a substantially better position than this
   * pure converter ever could without duplicating that same logic.
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

  return opts.playerStart === undefined
    ? doc
    : { ...doc, spawn: { x: opts.playerStart.x, y: opts.playerStart.y, floor: FLOOR_ID } };
}
