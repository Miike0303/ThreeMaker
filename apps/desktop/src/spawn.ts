import type { GridPosition } from '@threemaker/gameplay';

/** The subset of `PassabilityGrid` (`@threemaker/gameplay`) needed to pick a spawn tile. */
export interface StandabilityQuery {
  readonly width: number;
  readonly height: number;
  isStandable(x: number, y: number): boolean;
}

/** A resolved spawn: a tile position plus which floor it's on (design "Runtime spawn"). Structurally matches `map-document-runtime.ts`'s `TranslatedSpawn` -- no import needed, both are `{x, y, floorIndex}`. */
export interface FloorSpawn extends GridPosition {
  readonly floorIndex: number;
}

/**
 * Resolves a session's initial spawn (loop-crear-jugar design, "Runtime
 * spawn"): an authored spawn wins when its `floorIndex` exists among
 * `floors` and its tile is standable there; otherwise falls back to
 * `findSpawnTile`'s nearest-standable search -- on the authored floor when
 * that floor exists but the tile itself isn't standable (a stale authored
 * doc vs. its own layers), or on `floors[0]` when no authored spawn was
 * given at all or its `floorIndex` doesn't exist. Never throws over a bad
 * authored spawn (spec: "missing spawn falls back silently") -- only
 * `findSpawnTile` itself can still throw, and only when a floor has no
 * standable tile anywhere.
 */
export function resolveInitialSpawn(
  floors: readonly StandabilityQuery[],
  authoredSpawn: FloorSpawn | undefined,
  fallbackOriginX: number,
  fallbackOriginY: number,
): FloorSpawn {
  const floorIndex =
    authoredSpawn !== undefined && floors[authoredSpawn.floorIndex] !== undefined
      ? authoredSpawn.floorIndex
      : 0;
  const floor = floors[floorIndex];
  if (!floor) {
    throw new Error(
      `resolveInitialSpawn: no floor at index ${floorIndex} (have ${floors.length}).`,
    );
  }

  if (
    authoredSpawn !== undefined &&
    floorIndex === authoredSpawn.floorIndex &&
    floor.isStandable(authoredSpawn.x, authoredSpawn.y)
  ) {
    return authoredSpawn;
  }

  const position = findSpawnTile(floor, fallbackOriginX, fallbackOriginY);
  return { x: position.x, y: position.y, floorIndex };
}

/**
 * Finds the nearest standable tile to `(originX, originY)` (typically the
 * map's center), so the player never spawns hardcoded on top of a wall.
 * Searches outward ring by ring (Chebyshev distance), checking each ring's
 * tiles in a fixed top/right/bottom/left order for a deterministic result
 * when multiple tiles are equally close.
 *
 * Throws if no standable tile exists anywhere on the grid (a map with no
 * walkable floor at all is not a valid map to spawn on).
 */
export function findSpawnTile(
  grid: StandabilityQuery,
  originX: number,
  originY: number,
): GridPosition {
  const originTileX = Math.round(originX);
  const originTileY = Math.round(originY);
  const maxRadius = Math.max(grid.width, grid.height);

  for (let radius = 0; radius <= maxRadius; radius++) {
    for (const candidate of ringOffsets(radius)) {
      const x = originTileX + candidate.x;
      const y = originTileY + candidate.y;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      if (grid.isStandable(x, y)) return { x, y };
    }
  }

  throw new Error('No standable tile found on this map.');
}

/** Offsets (relative to the center) of every tile at exactly Chebyshev distance `radius`, in top/right/bottom/left order. `radius === 0` yields just the center itself. */
function ringOffsets(radius: number): GridPosition[] {
  if (radius === 0) return [{ x: 0, y: 0 }];

  const points: GridPosition[] = [];
  for (let x = -radius; x <= radius; x++) points.push({ x, y: -radius }); // top edge
  for (let y = -radius + 1; y <= radius; y++) points.push({ x: radius, y }); // right edge
  for (let x = radius - 1; x >= -radius; x--) points.push({ x, y: radius }); // bottom edge
  for (let y = radius - 1; y >= -radius + 1; y--) points.push({ x: -radius, y }); // left edge
  return points;
}
