import type { StairTraversalWaypoint } from '@threemaker/gameplay';
import { ElevationField, PassabilityGrid } from '@threemaker/gameplay';
import type { RampCellInput, RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import type { SheetPixelSizes } from '@threemaker/renderer';
import type * as THREE from 'three/webgpu';

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

/**
 * One floor's render-side inputs (Plantas Apiladas design: "each floor is a
 * map" -- the renderer half of that; see `FloorGameplay` above for the
 * gameplay half). `floorId`/`baseElevation` mirror the matching
 * `FloorGameplay` entry built from the same source.
 *
 * Moved here from `main.ts`'s local scope (loop-crear-jugar, Slice 2, "W4"):
 * this is the shared contract `apps/desktop/src/map-document-runtime.ts`'s
 * translator targets for its per-floor output, rather than a hand-rolled
 * structural duplicate. The translator is pure (no Tauri fs, no texture
 * loading), so it cannot populate `textures`/`sheetPixelSizes` itself -- its
 * return type references `Omit<FloorSource, 'textures' | 'sheetPixelSizes'>`
 * for exactly those two fields; a later slice's texture-resolution step
 * merges them in before the result reaches `createMapSession`.
 */
export interface FloorSource {
  readonly floorId: string;
  readonly baseElevation: number;
  readonly map: RpgmMap;
  readonly tileset: RpgmTileset;
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly sheetPixelSizes: SheetPixelSizes;
  readonly rampCells?: readonly RampCellInput[];
  /**
   * This floor's own room-id grid (design "Ceilings and Interior Occlusion",
   * obs #117 gotcha), e.g. `@threemaker/map-format`'s `computeRoomIdGrid`
   * output -- 0 = no room. Consumed TWO ways: (1) `session.roomTracker`
   * reads it to resolve which room the player stands on THIS floor, and (2)
   * `buildFloorRender` passes the floor BELOW's grid as the `ceilingCarve`
   * option when building THIS floor's scene, so this floor's ground-quad
   * tiles get carved into per-room ceiling meshes over the floor below's
   * rooms. `undefined` on a floor with no authored rooms, mirroring
   * `rampCells`'s "no ramp" default -- no carving, `roomTracker.roomAt`
   * always resolves to 0 for this floor.
   */
  readonly roomIdGrid?: Uint16Array;
}

/**
 * A stair-link resolved to numeric `floors` array indices (Plantas Apiladas
 * Slice 5, design "Render-position handoff"). Mirrors
 * `@threemaker/map-format`'s `StairLinkDocument`, except `fromFloor`/
 * `toFloor`/`waypoints[].floor` are plain array indices here rather than
 * stable string ids -- `@threemaker/gameplay`'s `StairTraversal` stays
 * map-format-agnostic (see its own doc comment), so resolving a document's
 * string floor ids to numeric indices is this app's job (see `main.ts:537`'s
 * doc comment, the original source of this contract, for the full
 * rationale). `apps/desktop/src/main.ts`'s own demo data is authored
 * directly in index form (see `buildDevDemoStairLinks`); the loop-crear-jugar
 * translator (`map-document-runtime.ts`) resolves a real `.tmmap`
 * document's `StairLinkDocument` string ids against its own `floors` array
 * order the same way.
 *
 * Moved here from `main.ts`'s local scope (loop-crear-jugar, Slice 2, "W4")
 * so the translator's return type is a real shared contract, not a
 * structural duplicate.
 */
export interface StairLinkRuntime {
  readonly id: string;
  readonly fromFloor: number;
  readonly toFloor: number;
  readonly bidirectional: boolean;
  readonly waypoints: readonly StairTraversalWaypoint[];
}
