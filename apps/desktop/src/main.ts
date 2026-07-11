import type { EventHost, EventScript } from '@threemaker/core';
import { EventInterpreter, GameLoop, WorldState } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import {
  DIRECTION_DELTA,
  ElevationField,
  GridMover,
  NpcRegistry,
  PassabilityGrid,
  TriggerIndex,
} from '@threemaker/gameplay';
import type { RampCellInput, RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import { bindStoryToWorld, compileInk, InkDialogueProvider } from '@threemaker/narrative';
import type { SheetPixelSizes } from '@threemaker/renderer';
import {
  buildChunks,
  ChunkStreamer,
  DEFAULT_CHUNK_SIZE,
  generateSyntheticMap,
  loadSheetTexture,
  StreamingTilemapScene,
} from '@threemaker/renderer';
import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';
import type { CameraMode } from './camera-rig.js';
import { clampTiltDeg, computeCameraPose, cycleCameraMode } from './camera-rig.js';
import { CharacterSprite, tileCenterToWorld } from './character-sprite.js';
import { clampRange } from './clamp.js';
import type { DebugSnapshot } from './debug-panel.js';
import { createDebugPanel } from './debug-panel.js';
import { loadDemoContent } from './demo-content.js';
import {
  createDialogueOverlay,
  nextHighlightedIndex,
  resolveDialogueKeyAction,
} from './dialogue-ui.js';
import {
  fixtureCharacterUrl,
  fixtureImageUrl,
  fixtureJsonUrl,
  mzFixtureJsonUrl,
} from './fixture-paths.js';
import { groundYAt } from './ground-y.js';
import { createHd2dPipeline } from './hd2d-pipeline.js';
import type { Locale } from './i18n.js';
import { createI18n } from './i18n.js';
import { findSpawnTile } from './spawn.js';
import { WalkAnimation } from './walk-animation.js';

// The Roseliam fixture (see fixtures/README.md) ships 3 sample maps; Map007
// is the nicest of the three for this slice (a dungeon interior with both
// ground and upper-layer/"star" tiles).
const FIXTURE_MAP_ID = 7;
const FIXTURE_MAP_FILE = 'Map007.json';

// mz-project1 (see fixtures/README.md): a real RPG Maker MZ project, genuine
// dir/data layout, with a painted region hill on Map001 -- used by the dev
// map-cycle toggle to exercise region-based elevation end-to-end.
const MZ_FIXTURE_MAP_ID = 1;
const MZ_FIXTURE_MAP_FILE = 'Map001.json';

/**
 * Slice 4 exit-criterion demo semantics (design: "Demo semantics" -- the
 * desktop harness hardcodes the mz-project1 hill's ramp tile ids; runtime
 * `.tmmap` loading, where the painter's own semantics would apply instead,
 * is out of scope this change). The fixture's Map001 paints a symmetric
 * region pyramid centered on column x=11 (region 0 ground -> 1 -> 2 -> 3
 * peak -> back down to 2 -> 1 -> 0, one height level per ring -- see
 * fixtures/mz-project1/data/Map001.json's region layer). This is a single
 * straight north-south corridor of ramp cells through the hill's center,
 * one per height transition on each side, so the character can climb from
 * ground to the region-3 peak and back down the same way.
 *
 * `(11, 4)` (the north-side entry onto the 2-tile peak) needs an explicit
 * `rampDirection` override: its two height-2 neighbors (north at (11,3) and
 * west at (10,4)) tie, and `computeRampGrid`'s deterministic tie-break
 * (south > east > west > north) would otherwise resolve to 'west' --
 * breaking the intended north-south corridor. Every other cell here has a
 * single unique lower neighbor and needs no override.
 *
 * `(9, 7)` is an extra ramp cell OUTSIDE that corridor: the passability
 * rule's edge-profile check only authorizes crossing a ramp cell ALONG its
 * own slope axis (design: "Perpendicular entry blocked"), never laterally
 * from a same-height ring neighbor -- so the ring1 band surrounding the
 * hill (region 1, height 1) has no route down to ground except through a
 * ramp cell approached from directly outside it. `findSpawnTile` happens to
 * place the player's spawn ON that ring1 band (nearest standable tile to
 * the mz map's center), which would otherwise strand them there with no
 * legitimate move able to reach ground at all. Tagging the spawn tile
 * itself resolves this (auto-derives 'south': its two height-0 neighbors,
 * west and south, tie, and the tie-break prefers south) -- from there,
 * ground (region 0) is flat and freely walkable over to the corridor's
 * `(11, 8)` entrance.
 */
const DEMO_RAMP_SEMANTICS: readonly RampCellInput[] = [
  { x: 9, y: 7 }, // spawn-adjacent descent, ring1 -> ground (auto: south)
  { x: 11, y: 2 }, // ring0 -> ring1 (auto: north)
  { x: 11, y: 3 }, // ring1 -> ring2 (auto: north)
  { x: 11, y: 4, rampDirection: 'north' }, // ring2 -> peak (override: tie-break would pick west)
  { x: 11, y: 5 }, // peak -> ring2, south side (auto: south)
  { x: 11, y: 6 }, // ring2 -> ring1, south side (auto: south)
  { x: 11, y: 7 }, // ring1 -> ring0, south side (auto: south)
];

// See fixtures/README.md: `Actor1.png` is the standard MV/MZ naming
// convention for a playable-party-member sheet (8 characters, 4x2 grid);
// character block 0 (top-left) is used as the player.
const CHARACTER_SHEET_FILE = 'Actor1';
const CHARACTER_INDEX = 0;
const CHARACTER_SHEET_COLUMNS = 4;
const CHARACTER_SHEET_ROWS = 2;

const LOCALE_STORAGE_KEY = 'threemaker:locale';

// `import.meta.glob` with `eager: true` turns every `./locales/*.json` file
// into an entry here at build time -- dropping in a new locale JSON file is
// the only step needed to add a language, no registry code to touch.
const localeModules = import.meta.glob('./locales/*.json', { eager: true }) as Record<
  string,
  { default: Locale }
>;

function localesFromModules(modules: Record<string, { default: Locale }>): Record<string, Locale> {
  const locales: Record<string, Locale> = {};
  for (const [path, module] of Object.entries(modules)) {
    const code = /([\w-]+)\.json$/.exec(path)?.[1];
    if (!code) continue;
    locales[code] = module.default;
  }
  return locales;
}

const i18n = createI18n(
  localesFromModules(localeModules),
  localStorage.getItem(LOCALE_STORAGE_KEY) ?? undefined,
);

function buildLocaleSelector(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'locale-selector';

  const label = document.createElement('label');
  label.htmlFor = 'locale-select';
  label.textContent = i18n.t('locale.selectorLabel');

  const select = document.createElement('select');
  select.id = 'locale-select';
  for (const { code, name } of i18n.available) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    if (code === i18n.locale) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    i18n.setLocale(select.value);
    localStorage.setItem(LOCALE_STORAGE_KEY, i18n.locale);
    label.textContent = i18n.t('locale.selectorLabel');
    document.title = i18n.t('app.title');
  });

  wrapper.append(label, select);
  return wrapper;
}

interface FixtureMapData {
  readonly map: RpgmMap;
  readonly tileset: RpgmTileset;
  readonly sheetPixelSizes: SheetPixelSizes;
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly characterTexture: THREE.Texture;
}

/** A loaded map's own tileset + sheet textures, without the (shared) player character sheet. */
interface MapSourceData {
  readonly map: RpgmMap;
  readonly tileset: RpgmTileset;
  readonly sheetPixelSizes: SheetPixelSizes;
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
}

function assertOk(response: Response): Response {
  if (!response.ok) {
    throw new Error(
      `Fixture request failed: ${response.status} ${response.statusText} (${response.url})`,
    );
  }
  return response;
}

/** Loads every sheet texture a tileset references (skipping unused/empty sheet slots). */
async function loadUsedSheetTextures(
  fixturesDir: string,
  tileset: RpgmTileset,
): Promise<{
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly sheetPixelSizes: SheetPixelSizes;
}> {
  const usedSheets = (Object.entries(tileset.sheetNames) as [TileSheetId, string][]).filter(
    ([, name]) => name.length > 0,
  );

  const textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  const sheetPixelSizes: SheetPixelSizes = {};
  await Promise.all(
    usedSheets.map(async ([sheet, name]) => {
      // loadSheetTexture applies the crisp no-mipmap default; createMapSession
      // re-configures these same textures with mipmaps/anisotropy later, so
      // the configuration here is a placeholder, not the final filtering.
      const texture = await loadSheetTexture(fixtureImageUrl(fixturesDir, name));
      textures[sheet] = texture;
      const image = texture.image as { width: number; height: number };
      sheetPixelSizes[sheet] = { width: image.width, height: image.height };
    }),
  );

  return { textures, sheetPixelSizes };
}

/**
 * Loads Map007 + its tileset + the player character sheet from the Roseliam
 * fixture over Vite's dev-only `/@fs/` endpoint (see fixture-paths.ts and
 * vite.config.ts) and loads every tileset sheet texture Map007 references.
 * Throws if the fixture folder is missing or this isn't a dev server
 * (`__FIXTURES_DIR__` still resolves, but `/@fs/` only exists under `vite
 * dev`) -- callers show a localized message instead of letting this crash
 * the app.
 */
async function loadFixtureMapData(): Promise<FixtureMapData> {
  const [mapJson, tilesetsJson, characterTexture] = await Promise.all([
    fetch(fixtureJsonUrl(__FIXTURES_DIR__, FIXTURE_MAP_FILE)).then((res) => assertOk(res).json()),
    fetch(fixtureJsonUrl(__FIXTURES_DIR__, 'Tilesets.json')).then((res) => assertOk(res).json()),
    loadSheetTexture(fixtureCharacterUrl(__FIXTURES_DIR__, CHARACTER_SHEET_FILE)),
  ]);

  const map = parseMap(mapJson, FIXTURE_MAP_ID);
  const tilesets = parseTilesets(tilesetsJson);
  const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
  if (!tileset) {
    throw new Error(`Tileset ${map.tilesetId} not found for ${FIXTURE_MAP_FILE}.`);
  }

  const { textures, sheetPixelSizes } = await loadUsedSheetTextures(__FIXTURES_DIR__, tileset);

  return { map, tileset, sheetPixelSizes, textures, characterTexture };
}

/**
 * Loads Map001 + its tileset from the mz-project1 fixture -- a genuine RPG
 * Maker MZ dir/data-layout project (unlike Roseliam's flat layout, hence
 * `mzFixtureJsonUrl` rather than `fixtureJsonUrl`) whose Map001 carries a
 * painted region hill, used by the dev map-cycle toggle. No character sheet:
 * the same player sprite/texture is reused across every map. Dev-only, same
 * caveats as `loadFixtureMapData`.
 */
async function loadMzFixtureMapData(): Promise<MapSourceData> {
  const [mapJson, tilesetsJson] = await Promise.all([
    fetch(mzFixtureJsonUrl(__MZ_FIXTURES_DIR__, MZ_FIXTURE_MAP_FILE)).then((res) =>
      assertOk(res).json(),
    ),
    fetch(mzFixtureJsonUrl(__MZ_FIXTURES_DIR__, 'Tilesets.json')).then((res) =>
      assertOk(res).json(),
    ),
  ]);

  const map = parseMap(mapJson, MZ_FIXTURE_MAP_ID);
  const tilesets = parseTilesets(tilesetsJson);
  const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
  if (!tileset) {
    throw new Error(`Tileset ${map.tilesetId} not found for ${MZ_FIXTURE_MAP_FILE}.`);
  }

  const { textures, sheetPixelSizes } = await loadUsedSheetTextures(__MZ_FIXTURES_DIR__, tileset);

  return { map, tileset, sheetPixelSizes, textures };
}

// World-space size of one tile edge; must match everywhere a world position
// is derived from a tile coordinate (chunk geometry, the character quad).
const TILE_WORLD_SIZE = 1;
// World-space height of one region-elevation step; must match the
// renderer's own default (`buildChunkGroup`'s `heightUnit` option, which
// also defaults to `tileWorldSize`) so the character/camera line up with
// the ground the tilemap actually renders.
const HEIGHT_UNIT = TILE_WORLD_SIZE;
// Player movement speed, in tiles/second.
const PLAYER_SPEED = 4;
// How quickly the camera catches up to the character; higher = snappier.
// Framerate-independent exponential smoothing (see `renderFixtureMap`).
const CAMERA_FOLLOW_SPEED = 6;

// HD-2D camera tuning knobs -- these seed the CameraRig's runtime-adjustable
// state (see `cameraTiltDeg`/`cameraDistance` below); they're no longer read
// directly by the render loop itself, only as the defaults `[`/`]` and
// `-`/`=` start from (and what a map switch's `focusCameraOnSpawn` resets
// distance to).
const CAMERA_TILT_DEG = 40;
const CAMERA_DISTANCE_FACTOR = 0.9; // distance = max(map width, height) * factor
// Cap the camera boom so a giant map cannot push the camera into the far
// plane; fixture-sized maps stay below the cap and are unaffected. Also the
// upper clamp for manual zoom-out (`-` key).
const CAMERA_MAX_DISTANCE = 24;
// Lower clamp for manual zoom-in (`=` key) -- close enough to read detail
// without clipping into the character/ground geometry.
const CAMERA_MIN_DISTANCE = 3;
const CAMERA_FOV_DEG = 45;
// Per-keypress adjustment step for the `[`/`]` (tilt) and `-`/`=` (zoom) keys.
const CAMERA_TILT_STEP_DEG = 5;
const CAMERA_ZOOM_STEP = 1;

const CAMERA_MODE_LOCALE_KEY: Record<CameraMode, string> = {
  hd2d: 'camera.mode.hd2d',
  'top-down': 'camera.mode.topDown',
  'first-person': 'camera.mode.firstPerson',
};

// Chunk streaming: only chunks within `STREAM_BUILD_RADIUS` chunks of the
// character keep live GPU geometry; the extra dispose-radius chunk is
// hysteresis so walking along a chunk border never build/dispose-thrashes.
const STREAM_BUILD_RADIUS = 2;
const STREAM_DISPOSE_RADIUS = 3;

// Dev-only giant synthetic stress map, toggled with the 'g' key.
const GIANT_MAP_SIZE = 512;
const GIANT_MAP_SEED = 20260710;

/** WASD/arrow keys -> the grid direction they move the character in. */
const MOVE_KEYS: Record<string, Direction> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

/** Tracks currently-held movement keys in press order; the most recently pressed one (still held) wins when several are held at once. */
function createMostRecentHeldDirection(): {
  current(): Direction | undefined;
  /**
   * Clears every held direction without touching the keydown/keyup
   * listeners. Movement keys (arrows/WASD) double as dialogue
   * navigation/advance keys -- if the player holds an arrow to walk into an
   * NPC, the keydown that opens dialogue never fires a matching keyup, so
   * the arrow stays "held" for movement purposes. Call this when a script
   * ends (`script:finished`/`script:failed`) so that stale entry doesn't
   * immediately auto-walk the player the next idle frame; any key still
   * physically held re-registers on its next keydown/repeat.
   */
  clear(): void;
} {
  const held: Direction[] = [];

  window.addEventListener('keydown', (event) => {
    const direction = MOVE_KEYS[event.key.toLowerCase()];
    if (!direction) return;
    const index = held.indexOf(direction);
    if (index !== -1) held.splice(index, 1);
    held.push(direction);
  });
  window.addEventListener('keyup', (event) => {
    const direction = MOVE_KEYS[event.key.toLowerCase()];
    if (!direction) return;
    const index = held.indexOf(direction);
    if (index !== -1) held.splice(index, 1);
  });

  return {
    current: () => held[held.length - 1],
    clear: () => {
      held.length = 0;
    },
  };
}

/** Everything owned by one loaded map: streamed tilemap, passability, and the character's mover. */
interface MapSession {
  readonly map: RpgmMap;
  readonly tilemap: StreamingTilemapScene;
  readonly streamer: ChunkStreamer;
  readonly mover: GridMover;
  readonly spawn: { readonly x: number; readonly y: number };
  /**
   * Region-derived elevation + ramp slope data (see `@threemaker/gameplay`'s
   * `ElevationField`), shared with this session's `PassabilityGrid` so both
   * agree on where a ramp's surface sits. Sampled via `groundYAt` (see
   * `ground-y.ts`) to lift the character/NPC/camera onto elevated ground,
   * continuously across a ramp step.
   */
  readonly elevation: ElevationField;
  dispose(): void;
}

async function renderFixtureMap(container: HTMLElement, data: FixtureMapData): Promise<void> {
  const { map: fixtureMap, tileset, sheetPixelSizes, textures, characterTexture } = data;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(fixtureMap.width * 0.3, 20, fixtureMap.height * 0.2);
  scene.add(light, new THREE.AmbientLight(0x404060, 2));

  // Created (and initialized) before any map session so `getMaxAnisotropy()`
  // is available up front -- every session's tileset materials use it for
  // the HD-2D filtered-environment texture configuration (see
  // `createMapSession` below and `PixelArtTextureOptions`).
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  await renderer.init();
  const maxAnisotropy = renderer.getMaxAnisotropy();

  /**
   * Builds a fully wired session for one map: chunk data for the whole map
   * (pure, cheap to keep), a streaming scene that only holds GPU geometry
   * near the character, passability + a spawn tile computed from it (never
   * hardcoded), and the character's grid mover. `mapTileset`/`mapTextures`/
   * `mapSheetPixelSizes` are per-map-source (the mz-project1 dev toggle uses
   * an entirely different tileset/texture set than the Roseliam fixture);
   * textures are shared across sessions of the same source
   * (`ownsTextures: false`), so cycling back to a previously-seen map never
   * reloads them.
   */
  function createMapSession(
    map: RpgmMap,
    mapTileset: RpgmTileset,
    mapTextures: Partial<Record<TileSheetId, THREE.Texture>>,
    mapSheetPixelSizes: SheetPixelSizes,
    rampCells: readonly RampCellInput[] = [],
  ): MapSession {
    const chunks = buildChunks(
      map,
      mapTileset,
      mapSheetPixelSizes,
      DEFAULT_CHUNK_SIZE,
      undefined,
      rampCells,
    );
    const tilemap = new StreamingTilemapScene(chunks, mapTextures, {
      tileWorldSize: TILE_WORLD_SIZE,
      ownsTextures: false,
      // HD-2D convention (Octopath Traveler): the tileset environment is
      // filtered/mipmapped so it doesn't shimmer/alias under perspective
      // minification while walking; the character sprite (loaded separately,
      // see `loadFixtureMapData`) keeps the crisp nearest/no-mipmap default.
      textureOptions: { mipmaps: true, maxAnisotropy },
    });
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: map.width,
      mapHeight: map.height,
      buildRadius: STREAM_BUILD_RADIUS,
      disposeRadius: STREAM_DISPOSE_RADIUS,
    });

    // `rampCells` defaults to `[]` for every map except the mz-project1 dev
    // map-cycle map (see `DEMO_RAMP_SEMANTICS` above, passed in by this
    // function's only 'mz'-mode caller below) -- an empty list degenerates
    // every ramp lookup to "no ramp" (an all-zero rampGrid), so passability/
    // height sampling/geometry stay byte-identical to pre-ramp behavior on
    // every other map. Shared between `passability` and the session's own
    // height sampling (`groundYAt`) so both can never disagree about where a
    // ramp's surface sits; `buildChunks` above receives the SAME list so the
    // rendered slope and the walkable slope always agree.
    const elevation = new ElevationField(map, rampCells);
    const passability = new PassabilityGrid(map, mapTileset, elevation);
    const spawn = findSpawnTile(passability, map.width / 2, map.height / 2);
    const mover = new GridMover({
      x: spawn.x,
      y: spawn.y,
      speed: PLAYER_SPEED,
      // Composed per @threemaker/gameplay's documented pattern
      // (NpcRegistry#occupies JSDoc): PassabilityGrid stays terrain-only,
      // NPC collision is added at this callsite. `npcRegistry` and
      // `demoMapActive` are declared later in this function (demo wiring,
      // below) but already initialized by the time this closure is ever
      // invoked (first call happens from the game loop, well after setup
      // completes) -- `demoMapActive` also scopes the check to the fixture
      // map, since the demo NPCs' tiles are meaningless on the dev map-cycle's
      // other maps.
      canMove: (x, y, direction) => {
        if (!passability.canMove(x, y, direction)) return false;
        if (!demoMapActive || !npcRegistry) return true;
        const delta = DIRECTION_DELTA[direction];
        return !npcRegistry.occupies(x + delta.x, y + delta.y);
      },
    });

    // Build the spawn surroundings before the first frame renders.
    tilemap.applyDiff(streamer.update(spawn.x, spawn.y));
    scene.add(tilemap.group);

    return {
      map,
      tilemap,
      streamer,
      mover,
      spawn,
      elevation,
      dispose() {
        scene.remove(tilemap.group);
        tilemap.dispose();
      },
    };
  }

  let session = createMapSession(fixtureMap, tileset, textures, sheetPixelSizes);
  const walkAnimation = new WalkAnimation();

  const character = new CharacterSprite({
    texture: characterTexture,
    sheetColumns: CHARACTER_SHEET_COLUMNS,
    sheetRows: CHARACTER_SHEET_ROWS,
    characterIndex: CHARACTER_INDEX,
    tileWorldSize: TILE_WORLD_SIZE,
  });
  character.setTilePosition(
    session.mover.renderPosition.x,
    session.mover.renderPosition.y,
    TILE_WORLD_SIZE,
    groundYAt(session.elevation, session.mover.tile.x, session.mover.tile.y, HEIGHT_UNIT),
  );
  scene.add(character.mesh);

  // The follow target: starts on the character and smoothly chases its world
  // position every frame (see the game loop below) instead of snapping,
  // regardless of which CameraRig mode is active.
  const target = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );

  const heldDirection = createMostRecentHeldDirection();

  // Declared before the CameraRig state below on purpose: applyCameraPose()
  // closes over `hd2d`, so the pipeline must exist before any pose is applied.
  const hd2d = createHd2dPipeline(renderer, scene, camera);

  // CameraRig runtime state: HD-2D's tilt/distance are adjustable with
  // `[`/`]` and `-`/`=`; `cameraMode` cycles with `c`. See camera-rig.ts.
  let cameraMode: CameraMode = 'hd2d';
  let cameraTiltDeg = CAMERA_TILT_DEG;
  // Placeholder in the same unit (world-space boom distance); the real value
  // is computed from the map size by focusCameraOnSpawn() before first render.
  let cameraDistance = CAMERA_MAX_DISTANCE;

  /** Applies the CameraRig's pose for the current mode/target to the real THREE camera + character visibility + DoF focus. */
  function applyCameraPose(): void {
    const pose = computeCameraPose(
      cameraMode,
      { tiltDeg: cameraTiltDeg, distance: cameraDistance, fovDeg: CAMERA_FOV_DEG },
      { x: target.x, y: target.y, z: target.z, facing: session.mover.facing },
    );
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    character.mesh.visible = !pose.hideCharacter;
    hd2d.setFocusDistance(
      pose.focusFar
        ? Number.POSITIVE_INFINITY
        : camera.position.distanceTo(character.mesh.position),
    );
  }

  /** Re-aims the camera boom at the current session's spawn tile (initial view and map switches). Resets the manual zoom back to the map's auto-fit distance. */
  function focusCameraOnSpawn(): void {
    cameraDistance = Math.min(
      Math.max(session.map.width, session.map.height) * CAMERA_DISTANCE_FACTOR,
      CAMERA_MAX_DISTANCE,
    );
    target.set(
      tileCenterToWorld(session.spawn.x, TILE_WORLD_SIZE),
      groundYAt(session.elevation, session.spawn.x, session.spawn.y, HEIGHT_UNIT),
      tileCenterToWorld(session.spawn.y, TILE_WORLD_SIZE),
    );
    applyCameraPose();
  }

  focusCameraOnSpawn();

  // ponytail: only refreshed on a mode change ('c'), not on locale switch
  // (buildLocaleSelector's change handler lives in a separate closure in
  // `main()`, built before this one exists) -- an acceptable gap for an
  // optional indicator; re-open the language dropdown or press 'c' to see
  // the new locale's label.
  const cameraModeIndicator = document.createElement('div');
  cameraModeIndicator.className = 'camera-mode-indicator';
  function updateCameraModeIndicator(): void {
    cameraModeIndicator.textContent = i18n.t(CAMERA_MODE_LOCALE_KEY[cameraMode]);
  }
  updateCameraModeIndicator();
  container.appendChild(cameraModeIndicator);

  // Debug/controls overlay (top-right, below the locale selector): live
  // engine values + the key cheat-sheet. Available in production too (every
  // control row except the dev-only map-cycle one is a real engine feature,
  // same call already made for the camera-mode indicator above) -- see
  // `debug-panel.ts` for the collapsed-state persistence and row formatting.
  const debugPanel = createDebugPanel(i18n.t, {
    collapsedStorage: localStorage,
    devMode: import.meta.env.DEV,
  });
  container.appendChild(debugPanel.element);
  function buildDebugSnapshot(): DebugSnapshot {
    // Real RPG Maker maps commonly ship an empty `displayName` (it's the
    // in-game display name, distinct from the editor's map-tree name, which
    // this importer doesn't parse) -- Map007 in the Roseliam fixture is one
    // of them. Fall back to the numeric map id so the row is never blank.
    const mapName = session.map.displayName || `Map #${session.map.id ?? '?'}`;
    return {
      mapName,
      cameraModeLabel: i18n.t(CAMERA_MODE_LOCALE_KEY[cameraMode]),
      tiltDeg: cameraTiltDeg,
      distance: cameraDistance,
      liveChunks: session.tilemap.liveChunkCount,
      drawCalls: renderer.info.render.drawCalls,
      tile: { x: session.mover.tile.x, y: session.mover.tile.y },
      elevation: session.elevation.heightAt(session.mover.tile.x, session.mover.tile.y),
    };
  }
  debugPanel.update(buildDebugSnapshot());
  // Low rate (4 Hz), not per rendered frame -- these are diagnostic reads, not
  // anything that needs to track the 60 FPS game loop.
  setInterval(() => debugPanel.update(buildDebugSnapshot()), 250);

  let postProcessingEnabled = true;
  if (import.meta.env.DEV) {
    window.__hd2d = { renderer };
    window.__threemaker_debug = {
      get liveChunks() {
        return session.tilemap.liveChunkCount;
      },
      get drawCalls() {
        return renderer.info.render.drawCalls;
      },
      get mapName() {
        return session.map.displayName;
      },
      get tile() {
        return { x: session.mover.tile.x, y: session.mover.tile.y };
      },
      get cameraMode() {
        return cameraMode;
      },
      get tiltDeg() {
        return cameraTiltDeg;
      },
      get distance() {
        return cameraDistance;
      },
      get moving() {
        return session.mover.moving;
      },
      get renderPosition() {
        return { x: session.mover.renderPosition.x, y: session.mover.renderPosition.y };
      },
      // Continuous (interpolated) surface height at the character's current
      // fractional render position, tile-height units -- see
      // `ElevationField.surfaceHeightAt` -- so a headless check can assert
      // smooth height progress across a ramp step (Slice 4 exit criterion),
      // not just the discrete `tile`/`elevation` step values.
      get elevation() {
        return session.elevation.surfaceHeightAt(
          session.mover.renderPosition.x,
          session.mover.renderPosition.y,
        );
      },
      get cameraPosition() {
        return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      },
      get targetPosition() {
        return { x: target.x, y: target.y, z: target.z };
      },
      get dialogueState() {
        return interpreter?.state ?? 'idle';
      },
    };
  }

  // Narrative demo wiring (dev-only, layered on the fixture map -- see
  // demo-content.ts and dialogue-ui.ts): loads apps/desktop/src/demo/'s
  // map007 NPCs/triggers/events/ink and wires them through
  // @threemaker/core's EventInterpreter + @threemaker/narrative's
  // InkDialogueProvider. `demoMapActive` gates NPC/trigger interaction to
  // only the fixture map -- the 'g' dev map-cycle toggle below switches to
  // maps this demo's tile coordinates don't apply to.
  let npcRegistry: NpcRegistry | undefined;
  let triggerIndex: TriggerIndex | undefined;
  let interpreter: EventInterpreter | undefined;
  let demoEvents: EventScript | undefined;
  const npcSprites = new Map<string, CharacterSprite>();
  let demoMapActive = true;
  let activeEntityMove: {
    readonly mover: GridMover;
    readonly direction: Direction;
    stepsRemaining: number;
    readonly done: () => void;
  } | null = null;

  if (import.meta.env.DEV) {
    try {
      const demoContent = loadDemoContent();
      demoEvents = demoContent.events;

      const world = new WorldState();
      for (const [key, value] of demoContent.worldSeeds) world.set(key, value);

      const stories = new Map(
        [...demoContent.inkSources].map(([storyId, source]) => {
          const story = compileInk(source);
          bindStoryToWorld(story, { storyId, world });
          return [storyId, story] as const;
        }),
      );
      const provider = new InkDialogueProvider(stories);

      const host: EventHost = {
        moveEntity(entityId, direction, steps, done) {
          if (entityId !== 'player') {
            // NPCs are static in this demo slice (see NpcRegistry's
            // documented v1 ceiling) -- nothing to drive.
            done();
            return;
          }
          if (activeEntityMove) {
            // No parallel events in v1 (core's own documented ceiling), so
            // an overlapping request here would be a content bug; defensive.
            done();
            return;
          }
          activeEntityMove = {
            mover: session.mover,
            direction: direction as Direction,
            stepsRemaining: Math.max(0, Math.trunc(steps)),
            done,
          };
        },
        teleport(entityId, x, y, facing) {
          if (entityId !== 'player') return;
          session.mover.teleport(x, y, facing as Direction | undefined);
        },
      };

      interpreter = new EventInterpreter({ world, host, provider });
      npcRegistry = new NpcRegistry(demoContent.npcs.npcs);
      triggerIndex = new TriggerIndex(demoContent.triggers.triggers, session.spawn);

      for (const npc of demoContent.npcs.npcs) {
        if (npc.sprite.sheet !== CHARACTER_SHEET_FILE) {
          throw new Error(
            `Demo NPC "${npc.id}" references sprite sheet "${npc.sprite.sheet}", but only "${CHARACTER_SHEET_FILE}" is loaded.`,
          );
        }
        const sprite = new CharacterSprite({
          texture: characterTexture,
          sheetColumns: CHARACTER_SHEET_COLUMNS,
          sheetRows: CHARACTER_SHEET_ROWS,
          characterIndex: npc.sprite.index,
          tileWorldSize: TILE_WORLD_SIZE,
        });
        sprite.setFrame(npc.facing, 1);
        sprite.setTilePosition(
          npc.x,
          npc.y,
          TILE_WORLD_SIZE,
          groundYAt(session.elevation, npc.x, npc.y, HEIGHT_UNIT),
        );
        scene.add(sprite.mesh);
        npcSprites.set(npc.id, sprite);
      }

      const dialogueOverlay = createDialogueOverlay(i18n.t);
      container.appendChild(dialogueOverlay.element);
      let highlightedIndex = 0;
      let pendingChoiceCount = 0;

      interpreter.signals.on('dialogue:line', (event) => {
        dialogueOverlay.showLine(event.speaker, event.text);
      });
      interpreter.signals.on('dialogue:choices', (event) => {
        highlightedIndex = 0;
        pendingChoiceCount = event.options.length;
        dialogueOverlay.showChoices(event.options, highlightedIndex);
      });
      interpreter.signals.on('dialogue:closed', () => {
        pendingChoiceCount = 0;
      });
      interpreter.signals.on('script:finished', () => {
        pendingChoiceCount = 0;
        dialogueOverlay.hide();
        // See createMostRecentHeldDirection's clear() doc: drops any stale
        // held-arrow entry left over from dialogue navigation so the player
        // doesn't auto-walk the instant control returns to them.
        heldDirection.clear();
      });
      interpreter.signals.on('script:failed', (event) => {
        pendingChoiceCount = 0;
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        console.error('Event script failed:', event.error);
        dialogueOverlay.showError(message);
        heldDirection.clear();
      });

      window.addEventListener('keydown', (event) => {
        if (event.repeat || !interpreter || !demoMapActive) return;

        if (interpreter.state === 'idle') {
          if (event.key.toLowerCase() !== 'e') return;
          const { x, y } = session.mover.tile;
          const facing = session.mover.facing;
          const npc = npcRegistry?.npcAdjacentFacing(x, y, facing);
          if (npc) {
            interpreter.run(demoEvents?.[npc.onInteract] ?? []);
            return;
          }
          for (const eventId of triggerIndex?.interact(x, y, facing) ?? []) {
            interpreter.run(demoEvents?.[eventId] ?? []);
          }
          return;
        }

        const hasChoices = interpreter.state === 'waiting-for-choice';
        const action = resolveDialogueKeyAction(event.key, hasChoices);
        if (!action) return;

        switch (action.kind) {
          case 'advance':
            if (interpreter.state === 'waiting-for-dialogue') interpreter.advance();
            return;
          case 'confirmHighlighted':
            interpreter.choose(highlightedIndex);
            return;
          case 'chooseIndex':
            if (action.index < pendingChoiceCount) interpreter.choose(action.index);
            return;
          case 'navigate':
            highlightedIndex = nextHighlightedIndex(
              highlightedIndex,
              action.delta,
              pendingChoiceCount,
            );
            dialogueOverlay.setHighlightedIndex(highlightedIndex);
            return;
        }
      });
    } catch (error) {
      console.error('Failed to load demo dialogue content:', error);
    }
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    switch (event.key.toLowerCase()) {
      case 'p':
        postProcessingEnabled = !postProcessingEnabled;
        hd2d.setEnabled(postProcessingEnabled);
        return;
      case 'c':
        // Real engine feature (camera mode), not a dev toggle -- available
        // in production builds, unlike the 'g' dev map-cycle below.
        cameraMode = cycleCameraMode(cameraMode);
        updateCameraModeIndicator();
        return;
      case '[':
        cameraTiltDeg = clampTiltDeg(cameraTiltDeg - CAMERA_TILT_STEP_DEG);
        return;
      case ']':
        cameraTiltDeg = clampTiltDeg(cameraTiltDeg + CAMERA_TILT_STEP_DEG);
        return;
      case '-':
      case '_':
        cameraDistance = clampRange(
          cameraDistance + CAMERA_ZOOM_STEP,
          CAMERA_MIN_DISTANCE,
          CAMERA_MAX_DISTANCE,
        );
        return;
      case '=':
      case '+':
        cameraDistance = clampRange(
          cameraDistance - CAMERA_ZOOM_STEP,
          CAMERA_MIN_DISTANCE,
          CAMERA_MAX_DISTANCE,
        );
        return;
      default:
        return;
    }
  });

  // Dev map-cycle toggle: 'g' cycles the fixture map -> a giant deterministic
  // synthetic map (same tileset, so all textures are reused) -> the
  // mz-project1 fixture's Map001 (a different tileset/texture set, carrying
  // a painted region hill to exercise elevation) -> back to the fixture map.
  if (import.meta.env.DEV) {
    type MapCycleMode = 'fixture' | 'giant' | 'mz';
    const CYCLE_ORDER: readonly MapCycleMode[] = ['fixture', 'giant', 'mz'];

    let mode: MapCycleMode = 'fixture';
    let giantMap: RpgmMap | undefined;
    let mzData: MapSourceData | undefined;
    let cycling = false;

    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.key.toLowerCase() !== 'g' || cycling) return;
      // Block map switching while a script is running/blocked: disposing
      // `session` mid-script would strand an in-flight moveEntity (its
      // `mover` reference goes stale, so the host's `done()` never fires
      // and the interpreter never returns to idle) and the dialogue overlay
      // would keep showing over a session it no longer belongs to (its
      // keydown handler also gates on `demoMapActive`, which this same
      // switch would flip, freezing advance/choose forever). Scripts always
      // run on the fixture map only, so simply refusing the cycle here --
      // not attempting to cancel the running script -- is consistent with
      // how the player's own movement is already paused during a script.
      if (interpreter && interpreter.state !== 'idle') return;
      cycling = true;
      void (async () => {
        try {
          mode = CYCLE_ORDER[(CYCLE_ORDER.indexOf(mode) + 1) % CYCLE_ORDER.length] ?? 'fixture';

          if (mode === 'giant') {
            giantMap ??= generateSyntheticMap({
              width: GIANT_MAP_SIZE,
              height: GIANT_MAP_SIZE,
              seed: GIANT_MAP_SEED,
            });
            session.dispose();
            session = createMapSession(giantMap, tileset, textures, sheetPixelSizes);
          } else if (mode === 'mz') {
            mzData ??= await loadMzFixtureMapData();
            session.dispose();
            session = createMapSession(
              mzData.map,
              mzData.tileset,
              mzData.textures,
              mzData.sheetPixelSizes,
              DEMO_RAMP_SEMANTICS,
            );
          } else {
            session.dispose();
            session = createMapSession(fixtureMap, tileset, textures, sheetPixelSizes);
          }
          focusCameraOnSpawn();

          // The demo NPCs/triggers are authored against the fixture map's
          // own tile coordinates -- irrelevant (and potentially
          // out-of-bounds) on the giant/mz maps, so hide the NPC billboards
          // and stop routing interact/enter input to them while cycled away.
          demoMapActive = mode === 'fixture';
          for (const sprite of npcSprites.values()) sprite.mesh.visible = demoMapActive;
        } catch (error) {
          console.error('Failed to switch to the next dev map-cycle map:', error);
          // Roll the mode back so the next 'g' press retries the same target
          // instead of silently skipping it.
          const previousIndex =
            (CYCLE_ORDER.indexOf(mode) - 1 + CYCLE_ORDER.length) % CYCLE_ORDER.length;
          mode = CYCLE_ORDER[previousIndex] ?? 'fixture';
        } finally {
          cycling = false;
        }
      })();
    });
  }

  // Custom clock, not `THREE.Clock` (deprecated since three r183) -- reuses
  // the engine's own game loop from `@threemaker/core`.
  const gameLoop = new GameLoop({
    onTick(dt) {
      const { mover, streamer, tilemap } = session;
      const interpreterIdle = !interpreter || interpreter.state === 'idle';

      // Input pause (design's data-flow contract): the player's own
      // requestMove is skipped whenever the interpreter isn't idle, so
      // walking is frozen during dialogue/scripts. A moveEntity command in
      // flight still drives the mover -- that's the interpreter itself
      // commanding the move, not the held keyboard direction.
      if (interpreterIdle) {
        const direction = heldDirection.current();
        if (direction) mover.requestMove(direction);
      } else if (activeEntityMove?.mover === mover) {
        mover.requestMove(activeEntityMove.direction);
      }

      const tileBeforeUpdate = mover.tile;
      mover.update(dt);

      if (activeEntityMove?.mover === mover) {
        const tileAfterUpdate = mover.tile;
        const stepped =
          tileAfterUpdate.x !== tileBeforeUpdate.x || tileAfterUpdate.y !== tileBeforeUpdate.y;
        if (stepped) activeEntityMove.stepsRemaining -= 1;
        // A step either landed (stepped) or was refused outright (blocked,
        // never started moving this frame) -- either way, once the mover
        // isn't mid-interpolation, this call is either finished (no steps
        // left) or blocked (didn't step at all): both end the moveEntity
        // per EventHost's "partial-block = still done" contract.
        if (!mover.moving && (activeEntityMove.stepsRemaining <= 0 || !stepped)) {
          const finished = activeEntityMove;
          activeEntityMove = null;
          finished.done();
        }
      }

      if (demoMapActive && interpreter && triggerIndex && demoEvents) {
        for (const eventId of triggerIndex.enter(mover.tile.x, mover.tile.y)) {
          interpreter.run(demoEvents[eventId] ?? []);
        }
      }

      for (const sprite of npcSprites.values()) sprite.faceCamera(camera);

      // Cheap per-frame streaming check: `update` early-exits with an empty
      // diff while the character stays inside the same chunk, so geometry
      // work only happens on chunk-boundary crossings.
      tilemap.applyDiff(streamer.update(mover.tile.x, mover.tile.y));

      if (mover.moving) walkAnimation.update(dt);
      else walkAnimation.reset();

      // The mover's fractional renderPosition (not its settled tile) is
      // sampled here: a step across a ramp connects two different heights
      // (PassabilityGrid's edge-profile rule authorizes exactly that
      // crossing, see passability-grid.ts), so groundYAt must interpolate
      // continuously across the step instead of holding the source tile's
      // height until completion -- otherwise the sprite/camera would pop at
      // the moment the step finishes. A flat (non-ramp) step still resolves
      // to one constant height throughout, since source and destination
      // heights are equal there -- interpolation is a no-op in that case.
      const groundY = groundYAt(
        session.elevation,
        mover.renderPosition.x,
        mover.renderPosition.y,
        HEIGHT_UNIT,
      );

      character.setFrame(mover.facing, walkAnimation.frameColumn(mover.moving));
      character.setTilePosition(
        mover.renderPosition.x,
        mover.renderPosition.y,
        TILE_WORLD_SIZE,
        groundY,
      );
      character.faceCamera(camera);

      // Framerate-independent exponential smoothing: the camera closes a
      // fixed fraction of the remaining distance per second, regardless of
      // how `dt` is chopped into frames.
      const desiredX = tileCenterToWorld(mover.renderPosition.x, TILE_WORLD_SIZE);
      const desiredZ = tileCenterToWorld(mover.renderPosition.y, TILE_WORLD_SIZE);
      const followAmount = 1 - Math.exp(-CAMERA_FOLLOW_SPEED * dt);
      target.x += (desiredX - target.x) * followAmount;
      target.y += (groundY - target.y) * followAmount;
      target.z += (desiredZ - target.z) * followAmount;
      applyCameraPose();
    },
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const stats = new Stats({ trackGPU: true });
  container.appendChild(stats.dom);
  stats.init(renderer);

  gameLoop.start();
  renderer.setAnimationLoop(() => {
    stats.begin();
    gameLoop.tick();
    hd2d.render();
    stats.end();
    stats.update();
  });
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container element.');

  document.title = i18n.t('app.title');
  document.body.appendChild(buildLocaleSelector());

  const statusEl = document.createElement('div');
  statusEl.className = 'status-message';
  statusEl.textContent = i18n.t('map.loading');
  container.appendChild(statusEl);

  // `/@fs/` and `server.fs.allow` (vite.config.ts) only exist under `vite
  // dev` -- a production build has no dev server to serve the (git-ignored,
  // never-shipped) fixture from, so show the same message a missing fixture
  // would produce instead of attempting a request that cannot succeed.
  if (!import.meta.env.DEV) {
    statusEl.textContent = i18n.t('map.fixtureNotFound');
    return;
  }

  try {
    const data = await loadFixtureMapData();
    statusEl.remove();
    await renderFixtureMap(container, data);
  } catch (error) {
    console.error('Failed to load the Roseliam fixture map:', error);
    statusEl.textContent = i18n.t('map.fixtureNotFound');
  }
}

main().catch((error: unknown) => {
  console.error('Failed to start ThreeMaker desktop renderer:', error);
});
