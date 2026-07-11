import type { RpgmMap } from '@threemaker/importer-rpgm';

/**
 * Dev-only synthetic map generator for streaming stress tests. Produces an
 * `RpgmMap`-shaped map of arbitrary size using real tile ids from the
 * Roseliam "Dungeon" tileset (the one Map007 uses, tileset id 4), so the
 * regular fixture textures and passability flags apply unchanged.
 *
 * Not part of the production rendering path -- exported for the desktop
 * app's giant-map toggle and the renderer's own tests.
 */

/** Roseliam Dungeon ground: A2 autotile kind 40, shape 0 (fully-connected interior). */
export const ROSELIAM_DUNGEON_GROUND_TILE_ID = 3968;
/** Roseliam Dungeon wall: A4 autotile kind 89, shape 15 (isolated pillar). */
export const ROSELIAM_DUNGEON_WALL_TILE_ID = 6335;
/** Roseliam Dungeon decorative B-sheet tile (used on Map007's layer 2). */
export const ROSELIAM_DUNGEON_DECOR_TILE_ID = 69;
/** Tileset id of the Roseliam "Dungeon" tileset Map007 references. */
export const ROSELIAM_DUNGEON_TILESET_ID = 4;

export interface SyntheticMapOptions {
  readonly width: number;
  readonly height: number;
  /** Deterministic LCG seed; the same seed always yields the same map. Default 1. */
  readonly seed?: number;
  /** Probability (0-1) of a wall pillar on any given tile. Default 0.04. */
  readonly wallDensity?: number;
  /** Probability (0-1) of a decorative layer-2 tile on a floor tile. Default 0.02. */
  readonly decorDensity?: number;
  /** Half-size of the guaranteed-walkable square kept clear around the map center. Default 3. */
  readonly clearRadius?: number;
  readonly tilesetId?: number;
}

/**
 * Numerical Recipes LCG -- deliberately not `Math.random`, which cannot be
 * seeded and would make every generated map (and every test) different.
 */
function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function generateSyntheticMap(options: SyntheticMapOptions): RpgmMap {
  const { width, height, seed = 1, wallDensity = 0.04, decorDensity = 0.02 } = options;
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`width must be a positive integer, got ${width}.`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`height must be a positive integer, got ${height}.`);
  }
  const clearRadius = options.clearRadius ?? 3;
  const tilesetId = options.tilesetId ?? ROSELIAM_DUNGEON_TILESET_ID;

  const random = createLcg(seed);
  const size = width * height;
  const layer0 = new Array<number>(size).fill(ROSELIAM_DUNGEON_GROUND_TILE_ID);
  const layer2 = new Array<number>(size).fill(0);
  const shadows = new Array<number>(size).fill(0);
  const emptyLayer = new Array<number>(size).fill(0);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Consume the generator in strict raster order so the layout is a pure
      // function of the seed, independent of which branches run.
      const wallRoll = random();
      const decorRoll = random();

      // The spawn row stays a full-width walkable corridor: long-distance
      // streaming walks (tests and the dev toggle) need a guaranteed
      // obstacle-free straight line, which random scatter cannot promise.
      const inSpawnClearing =
        y === centerY ||
        (Math.abs(x - centerX) <= clearRadius && Math.abs(y - centerY) <= clearRadius);
      if (inSpawnClearing) continue;

      if (wallRoll < wallDensity) {
        layer0[y * width + x] = ROSELIAM_DUNGEON_WALL_TILE_ID;
      } else if (decorRoll < decorDensity) {
        layer2[y * width + x] = ROSELIAM_DUNGEON_DECOR_TILE_ID;
      }
    }
  }

  // RPG Maker's editor auto-paints shadow mask 5 (west half dimmed) on the
  // tile east of a wall; replicate it so the synthetic map also exercises
  // shadow rendering at scale.
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const index = y * width + x;
      if (
        layer0[index - 1] === ROSELIAM_DUNGEON_WALL_TILE_ID &&
        layer0[index] === ROSELIAM_DUNGEON_GROUND_TILE_ID
      ) {
        shadows[index] = 5;
      }
    }
  }

  return {
    id: null,
    displayName: `Synthetic ${width}x${height}`,
    width,
    height,
    tilesetId,
    scrollType: 0,
    layers: {
      tileLayers: [layer0, emptyLayer.slice(), layer2, emptyLayer.slice()],
      shadows,
      regions: emptyLayer.slice(),
    },
  };
}
