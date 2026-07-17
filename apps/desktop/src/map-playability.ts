/**
 * Cheap pre-flight playability check (rpgm-whole-game-import boot-resilience
 * fix, post-deploy regression): true when `resolveInitialSpawn` would find a
 * GOOD spawn tile for this authored result -- "playable" means the center-out
 * `findSpawnTile` search, using the strengthened `isGoodSpawnCandidate`
 * predicate (standable AND has a usable exit; see
 * `@threemaker/gameplay`'s `PassabilityGrid.isGoodSpawnCandidate` and this
 * change's spawn-quality bug fix in `apps/desktop/src/spawn.ts`), finds
 * SOMETHING on the map, not merely that some tile is standable by its own
 * flags. Runs the exact same `buildFloorGameplay` + `resolveInitialSpawn`
 * calls `main.ts`'s `createMapSession` performs internally, but BEFORE ever
 * constructing a `THREE.WebGPURenderer` -- so a manifest entry with no
 * walkable, reachable tile anywhere never reaches the expensive, leak-prone
 * renderer setup at all.
 *
 * This is a real, observed occurrence, not a hypothetical edge case: a
 * fresh RPG Maker project's very first map (lowest mapId, first
 * `MapInfos.json` tree entry) is very often left as an unused/placeholder
 * map -- kingdom-of-subversion's `Map001` has a non-star tile id painted on
 * every cell of an upper layer whose flags block all 4 directions, which
 * `PassabilityGrid`'s decisive-layer rule (layers read top-down, a
 * non-star/non-empty tile decides) correctly treats as impassable
 * everywhere, matching RPG Maker's own passage-check algorithm. Blindly
 * rendering `manifest.maps[0]` and giving up on the whole batch-converted
 * game the moment THAT throws would be a much worse fallback than simply
 * skipping to the next map -- see `main.ts`'s manifest-scan loop.
 *
 * Pure/sync aside from the THREE-free gameplay containers it builds; safe
 * to call speculatively for every candidate manifest entry.
 */
import type { AuthoredMapResult } from './authored-map.js';
import { buildFloorGameplay } from './floor-runtime.js';
import { resolveInitialSpawn } from './spawn.js';

export function isAuthoredResultPlayable(authored: AuthoredMapResult): boolean {
  const primary = authored.floorSources[0];
  if (!primary) return false;
  try {
    const floors = authored.floorSources.map((source) =>
      buildFloorGameplay(
        source.floorId,
        source.baseElevation,
        source.map,
        source.tileset,
        source.rampCells ?? [],
      ),
    );
    resolveInitialSpawn(
      floors.map((floor) => floor.passability),
      authored.spawn,
      primary.map.width / 2,
      primary.map.height / 2,
    );
    return true;
  } catch (error) {
    console.error(
      'map-playability: manifest map has no standable spawn tile; treating it as unplayable.',
      error,
    );
    return false;
  }
}
