import { ElevationField, PassabilityGrid } from '@threemaker/gameplay';
import type { RampCellInput, RpgmMap, RpgmTileset } from '@threemaker/importer-rpgm';

/**
 * One floor's gameplay-only state (design: "each floor is a map" -- v2's
 * `FloorDocument` wraps one `MapLayers` group; this is its runtime
 * counterpart). `elevation`/`passability` are built via the SAME single-map
 * constructors change 1 already used, UNCHANGED -- see `buildFloorGameplay`.
 *
 * `floorId` mirrors `@threemaker/map-format`'s `FloorDocument.id`
 * (`'floor-0'` for a single-floor/v1-migrated map); `baseElevation` mirrors
 * `FloorDocument.baseElevation`. Neither is read by gameplay sampling itself
 * this slice -- they're carried here ready for slice 3's renderer offset
 * (`group.position.y = baseElevation * HEIGHT_UNIT`) and slice 5's stair
 * handoff (`fromFloor`/`toFloor` lookups), so a later slice can index by
 * `floorId` without reshaping this container again.
 */
export interface FloorGameplay {
  readonly floorId: string;
  readonly baseElevation: number;
  readonly elevation: ElevationField;
  readonly passability: PassabilityGrid;
}

/**
 * Builds one floor's gameplay container. `rampCells` defaults to `[]`,
 * degenerating to "no ramp" exactly like change 1's single-map construction
 * (see `ElevationField`/`PassabilityGrid`'s own docs) -- a single-floor map
 * built this way behaves byte-identically to constructing the pair directly.
 */
export function buildFloorGameplay(
  floorId: string,
  baseElevation: number,
  map: RpgmMap,
  tileset: RpgmTileset,
  rampCells: readonly RampCellInput[] = [],
): FloorGameplay {
  const elevation = new ElevationField(map, rampCells);
  const passability = new PassabilityGrid(map, tileset, elevation);
  return { floorId, baseElevation, elevation, passability };
}

/**
 * Routes gameplay queries (`.passability`/`.elevation`/`.baseElevation`) to
 * whichever floor is currently active. `currentFloor` is a plain mutable
 * field (not a getter/setter pair) so a single assignment flips floors
 * (design: "session owns `currentFloor` and routes"). `currentFloor` DOES
 * mutate at runtime: the dev-only 'floors' map-cycle mode in `main.ts`
 * forces it to `1` to drive the stacked-floors visual check, and Slice 5's
 * `StairTraversal` handoff will flip it for real gameplay on traversal
 * completion (design's "Render-position handoff" section) -- this router's
 * `.elevation`/`.passability`/`.baseElevation` getters are exactly what
 * makes a `currentFloor` reassignment take effect everywhere without any
 * other code needing to know a floor change happened.
 */
export interface FloorRouter {
  readonly floors: readonly FloorGameplay[];
  currentFloor: number;
  readonly elevation: ElevationField;
  readonly passability: PassabilityGrid;
  readonly baseElevation: number;
}

function activeFloor(router: Pick<FloorRouter, 'floors' | 'currentFloor'>): FloorGameplay {
  const floor = router.floors[router.currentFloor];
  if (!floor) {
    throw new Error(
      `No floor at index ${router.currentFloor} (have ${router.floors.length} floor(s)).`,
    );
  }
  return floor;
}

/** Builds a `FloorRouter` over an already-built floor array; defaults to floor 0. */
export function createFloorRouter(floors: readonly FloorGameplay[], initialFloor = 0): FloorRouter {
  const router: FloorRouter = {
    floors,
    currentFloor: initialFloor,
    get elevation(): ElevationField {
      return activeFloor(router).elevation;
    },
    get passability(): PassabilityGrid {
      return activeFloor(router).passability;
    },
    get baseElevation(): number {
      return activeFloor(router).baseElevation;
    },
  };
  return router;
}
