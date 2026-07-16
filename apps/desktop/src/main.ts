import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import type { EventHost, EventScript } from '@threemaker/core';
import { EventInterpreter, GameLoop, WorldState } from '@threemaker/core';
import type {
  Direction,
  StairTraversalFloor,
  StairTraversalFrame,
  StairTraversalWaypoint,
} from '@threemaker/gameplay';
import {
  DIRECTION_DELTA,
  GridMover,
  NpcRegistry,
  StairTraversal,
  StairTriggerTracker,
  TriggerIndex,
} from '@threemaker/gameplay';
import type { RampCellInput, RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import type { RoomDocument } from '@threemaker/map-format';
import { computeRoomIdGrid } from '@threemaker/map-format';
import { bindStoryToWorld, compileInk, InkDialogueProvider } from '@threemaker/narrative';
import type { FloorVisibilityPolicy, SheetPixelSizes } from '@threemaker/renderer';
import {
  buildChunks,
  ChunkStreamer,
  DEFAULT_CHUNK_SIZE,
  generateSyntheticMap,
  loadSheetTexture,
  OcclusionFloorPolicy,
  StreamingTilemapScene,
} from '@threemaker/renderer';
import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';
import type { AuthoredMapResult } from './authored-map.js';
import { loadAuthoredMap } from './authored-map.js';
import type { CameraMode } from './camera-rig.js';
import { clampTiltDeg, computeCameraPose, cycleCameraMode } from './camera-rig.js';
import {
  CharacterSprite,
  DEFAULT_SHEET_COLUMNS,
  DEFAULT_SHEET_ROWS,
  tileCenterToWorld,
} from './character-sprite.js';
import { buildPlaceholderCharacterTexture } from './character-sprite-placeholder.js';
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
import type { FloorRouter, FloorSource, StairLinkRuntime } from './floor-runtime.js';
import { buildFloorGameplay, createFloorRouter } from './floor-runtime.js';
import type { GameManifest } from './game-manifest.js';
import { parseGameManifest } from './game-manifest.js';
import { groundYAt } from './ground-y.js';
import { createHd2dPipeline } from './hd2d-pipeline.js';
import type { Locale } from './i18n.js';
import { createI18n } from './i18n.js';
import { MAP_DIR_RELATIVE, readManifestText, readMapDocumentText } from './map-file.js';
import {
  aboveFloorTilemap,
  createRoomTracker,
  driveRoomFade,
  resolveFadedRoomId,
} from './room-state.js';
import type { FloorSpawn } from './spawn.js';
import { resolveInitialSpawn } from './spawn.js';
import { isTauriAvailable } from './tauri-env.js';
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
// Single source of truth for the sheet's block grid: `character-sprite.ts`'s
// `DEFAULT_SHEET_COLUMNS`/`DEFAULT_SHEET_ROWS` (both the DEV-fixture sheet
// and Slice 4b's canvas-generated placeholder sheet match this same 4x2
// block grid -- see `character-sprite-placeholder.ts`).
const CHARACTER_SHEET_COLUMNS = DEFAULT_SHEET_COLUMNS;
const CHARACTER_SHEET_ROWS = DEFAULT_SHEET_ROWS;

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
  /** Which of `characterTexture`'s 8 character blocks (4 cols x 2 rows) is the player sprite -- rpgm-whole-game-import's real actor-sheet resolution overrides the `CHARACTER_INDEX` default when the manifest's `actorSheet` resolved. Defaults to `CHARACTER_INDEX` when omitted (every DEV-fixture/single-file-authored call site, unchanged). */
  readonly characterIndex?: number;
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

/** One resolved asset-store object: the decoded texture plus its pixel size (`buildChunks`/`CharacterSprite` both need both). */
interface ResolvedObjectTexture {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
}

const ASSET_STORE_OBJECTS_DIR = '.threemaker/asset-store/objects';

/**
 * Reads one asset-store object's bytes via Tauri fs and decodes it into a
 * texture (rpgm-whole-game-import: multi-map navigation + real player
 * sprite, both below). Deliberately duplicates `authored-map.ts`'s private
 * `resolveObjectTextureReal` (same path convention: `objects/{sha256[:2]}/
 * {sha256}`) rather than exporting it from there -- keeps `authored-map.ts`'s
 * public surface (`loadAuthoredMap`/`AuthoredMapDeps`) unchanged, and this is
 * the same "small local duplication over cross-module coupling" call this
 * codebase already makes elsewhere (see `cli.ts`'s `readPlayerStartIfStartMap`
 * ponytail comment, pre-refactor).
 */
async function resolveObjectTextureReal(sha256: string): Promise<ResolvedObjectTexture> {
  const bytes = await readFile(`${ASSET_STORE_OBJECTS_DIR}/${sha256.slice(0, 2)}/${sha256}`, {
    baseDir: BaseDirectory.Home,
  });
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const texture = await loadSheetTexture(blobUrl);
    const image = texture.image as { width: number; height: number };
    return { texture, width: image.width, height: image.height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Loads one manifest-entry map (multi-map navigation): same
 * `loadAuthoredMap` pipeline the single-file authored path uses, but reading
 * a specific file under `.threemaker/maps` (`relativeFile`, e.g.
 * `"kingdom-of-subversion/map007.tmmap.json"`) instead of the shared
 * `current.tmmap.json`. `loadAuthoredMap`'s own signature/behavior is
 * unchanged -- this only supplies a differently-scoped `readMapDocumentText`.
 */
function loadAuthoredMapAt(relativeFile: string): Promise<AuthoredMapResult | null> {
  return loadAuthoredMap({
    readMapDocumentText: () => readMapDocumentText(`${MAP_DIR_RELATIVE}/${relativeFile}`),
    resolveObjectTexture: resolveObjectTextureReal,
  });
}

/**
 * Resolves the manifest's optional `actorSheet` into a real player-sprite
 * texture. Fail-soft (W1-style, same convention as `authored-map.ts`'s own
 * per-slot texture resolution): a missing/unreadable object logs and falls
 * back to the canvas-generated placeholder, same as no `actorSheet` at all --
 * never blocks the map from rendering.
 */
async function resolvePlayerCharacterTexture(
  actorSheet: { readonly object: string; readonly characterIndex: number } | undefined,
): Promise<{ readonly texture: THREE.Texture; readonly characterIndex: number | undefined }> {
  if (!actorSheet) {
    return { texture: buildPlaceholderCharacterTexture(), characterIndex: undefined };
  }
  try {
    const resolved = await resolveObjectTextureReal(actorSheet.object);
    return { texture: resolved.texture, characterIndex: actorSheet.characterIndex };
  } catch (error) {
    console.error(
      `main: player character sheet object ${actorSheet.object} is missing or unreadable; using the placeholder sprite.`,
      error,
    );
    return { texture: buildPlaceholderCharacterTexture(), characterIndex: undefined };
  }
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

// Dev-only 2-floor synthetic demo (see the 'g' map-cycle's 'floors' mode
// below), used to visually verify the render window/Y-offset ahead of a real
// authored multi-floor `.tmmap`. Mirrors the design's `DEFAULT_FLOOR_HEIGHT`
// (packages/map-format/src/schema.ts) -- kept as a local constant rather than
// importing it, since this demo's floor size/height are its own fixed
// dev-only values, independent of whatever a real `.tmmap` document declares.
const DEV_DEMO_FLOOR_HEIGHT = 3;
const DEV_DEMO_FLOOR_SIZE = 32;

/**
 * Dev-only demo stair-link (Plantas Apiladas Slice 5, same DEMO_RAMP_SEMANTICS
 * hardcoding pattern -- editor stair authoring is deferred, design: "Stair
 * authoring: Hardcoded demo data in desktop"). A single one-tile diagonal
 * climb: stepping onto `(DEV_DEMO_STAIR_ENTRY_X, DEV_DEMO_STAIR_ROW)` on
 * floor 0 ascends to `(DEV_DEMO_STAIR_LANDING_X, DEV_DEMO_STAIR_ROW)` on
 * floor 1; `bidirectional: true` means stepping back onto that landing tile
 * on floor 1 walks the SAME waypoints in reverse back down (spec:
 * "no return path without bidirectional authoring" -- this demo authors one).
 * Both endpoints sit on `generateSyntheticMap`'s guaranteed-walkable center
 * row (`y === centerY` is a full-width clear corridor on every seed), so the
 * demo never places a stair endpoint on a wall tile regardless of each
 * floor's independent wall-scatter seed.
 *
 * `DEV_DEMO_STAIR_ROW` doubles as BOTH the Y-axis row shared by every
 * waypoint below AND the numeric base `DEV_DEMO_STAIR_ENTRY_X`/
 * `DEV_DEMO_STAIR_LANDING_X` offset from -- an X-axis value borrowed from a
 * Y-axis "ROW" constant. This only lines up because `DEV_DEMO_FLOOR_SIZE` is
 * square (width === height, so the same halfway-point arithmetic is valid on
 * either axis); a non-square demo floor would need separate row/column base
 * constants.
 */
const DEV_DEMO_STAIR_ROW = Math.floor(DEV_DEMO_FLOOR_SIZE / 2);
const DEV_DEMO_STAIR_ENTRY_X = DEV_DEMO_STAIR_ROW + 1;
const DEV_DEMO_STAIR_LANDING_X = DEV_DEMO_STAIR_ROW + 2;

/**
 * Dev-only demo room (Ceilings and Interior Occlusion, design
 * "Player-current-room runtime": "DEV floors demo gets hardcoded
 * RoomDocuments, same DEV-gated pattern as the stair demo"). A single
 * rectangular "library" room on floor 0, well clear of
 * `DEV_DEMO_STAIR_ROW`'s corridor so the room and the stair demo never
 * overlap. Its `computeRoomIdGrid` output is passed as floor 0's
 * `FloorSource.roomIdGrid`, which floor 1's scene carves into a per-room
 * ceiling mesh (see `buildFloorRender`'s `ceilingCarve` wiring) -- walking
 * into this rect while on floor 0 should fade floor 1's ceiling directly
 * above it toward ~0.15 opacity (hd2d/top-down only, obs #110 locked
 * decision).
 */
const DEV_DEMO_ROOM_ID = 'demo-library';

function buildDevDemoRooms(): readonly RoomDocument[] {
  return [
    {
      id: DEV_DEMO_ROOM_ID,
      name: 'Demo Library',
      floor: 'floor-0',
      rects: [{ x: 2, y: 2, width: 10, height: 10 }],
    },
  ];
}

function buildDevDemoStairLinks(): readonly StairLinkRuntime[] {
  return [
    {
      id: 'demo-stair-0-1',
      fromFloor: 0,
      toFloor: 1,
      bidirectional: true,
      waypoints: [
        { x: DEV_DEMO_STAIR_ENTRY_X, y: DEV_DEMO_STAIR_ROW, floor: 0 },
        { x: DEV_DEMO_STAIR_LANDING_X, y: DEV_DEMO_STAIR_ROW, floor: 1 },
      ],
    },
  ];
}

/** `DIRECTION_DELTA`'s inverse: the cardinal `Direction` a step from `from` to `to` represents, or `undefined` when both cells coincide. Used to face the character along a stair-link's final segment at the completion frame. */
function directionBetween(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): Direction | undefined {
  if (to.x > from.x) return 'right';
  if (to.x < from.x) return 'left';
  if (to.y > from.y) return 'down';
  if (to.y < from.y) return 'up';
  return undefined;
}

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

/**
 * One floor's renderer-side state: a `StreamingTilemapScene` + `ChunkStreamer`
 * pair, or `undefined` while this floor is outside the visibility window.
 * Kept in main.ts rather than folded into `FloorGameplay`/floor-runtime.ts --
 * that module stays DOM/three-free by design (see its own doc comments), so
 * the renderer-facing half of a floor's runtime lives alongside the rest of
 * this file's three.js scene wiring instead. Re-entering the window rebuilds
 * a FRESH `render` from `source` (design: "re-window on swap = dispose +
 * fresh streamer.update") rather than reusing a disposed instance --
 * `StreamingTilemapScene` cannot be un-disposed.
 */
interface FloorRenderSlot {
  readonly source: FloorSource;
  render: { readonly tilemap: StreamingTilemapScene; readonly streamer: ChunkStreamer } | undefined;
}

/** Everything owned by one loaded map: per-floor streamed tilemaps, passability, and the character's mover. */
interface MapSession {
  readonly map: RpgmMap;
  readonly mover: GridMover;
  readonly spawn: { readonly x: number; readonly y: number };
  /**
   * Per-floor gameplay containers (design "Plantas Apiladas": "each floor is
   * a map") -- `floorRouter.floors` holds one `{floorId, baseElevation,
   * elevation, passability}` entry per floor, and `floorRouter.currentFloor`
   * selects which one gameplay queries route to. `floorRouter.elevation`/
   * `.passability` transparently route to the active floor's container;
   * every call site below reads `session.floorRouter.elevation` (see
   * `groundYAt` call sites) rather than a plain `session.elevation` field.
   */
  readonly floorRouter: FloorRouter;
  /** Sum of live GPU chunk counts across every floor currently in the render window (debug/telemetry only -- see `buildDebugSnapshot`). */
  liveChunkCount(): number;
  /**
   * Re-derives the render window around `(focusX, focusY)` via
   * `WindowedFloorPolicy`: disposes floors that fell out of the window,
   * builds a fresh `{tilemap, streamer}` for floors that entered it, and
   * streams chunks (via each floor's own `ChunkStreamer`) for every floor
   * still in the window. Cheap to call every frame -- each floor's
   * `ChunkStreamer.update` early-exits while the focus tile stays in the same
   * chunk, same as the single-floor streaming this replaces.
   *
   * `floorOverride`, when given, replaces `floorRouter.currentFloor` as the
   * window's pivot -- Slice 5's stair-link handoff passes
   * `max(fromFloor, toFloor)` while a traversal is in progress (design:
   * "Render window stays keyed to max(fromFloor,toFloor) until completion")
   * so neither the source nor destination floor disposes mid-climb, without
   * mutating `floorRouter.currentFloor` itself before the completion frame.
   */
  applyFloorWindow(focusX: number, focusY: number, floorOverride?: number): void;
  /**
   * Resolves which authored room (if any) the player currently stands in on
   * `floorIndex` (design "Player-current-room runtime") -- 0 = unauthored.
   * Thin pass-through to `room-state.ts`'s `RoomTracker.roomAt`.
   */
  roomIdAt(floorIndex: number, x: number, y: number): number;
  /**
   * Drives the ceiling fade for the floor whose scene represents
   * `floorIndex`'s rooms -- i.e. `floorIndex + 1` (design gotcha, obs #117:
   * floor i's ceiling is carved from floor (i-1)'s room grid, so fading
   * "the room the player stands in on floor i" means driving floor i+1's
   * scene). `roomId` must already be resolved through the camera-mode gate
   * (`resolveFadedRoomId`) by the caller, or forced to `null` during stair
   * traversal (design branch (b): "During traversal: setFadedRoom(null)").
   * A no-op when there is no floor above (top floor / single-floor maps).
   */
  driveCeilingFade(floorIndex: number, roomId: number | null, dt: number): void;
  /**
   * Looks up a stair-link waypoint path that starts at `(x, y)` on
   * `floorIndex` (Slice 5's auto-on-step trigger, design "Stair trigger:
   * Auto-on-step onto an entry waypoint"). Returns the waypoints in
   * traversal order -- the authored order when `(floorIndex, x, y)` matches a
   * link's entry (`waypoints[0]`), or the REVERSED order when it matches a
   * `bidirectional` link's landing (`waypoints[waypoints.length - 1]`).
   * Returns `undefined` when no stair-link starts here (every map with no
   * `stairLinks` -- i.e. every real map today -- always returns `undefined`).
   */
  stairTriggerAt(
    floorIndex: number,
    x: number,
    y: number,
  ): readonly StairTraversalWaypoint[] | undefined;
  /**
   * Records `(floorIndex, x, y)` as already-checked without evaluating any
   * stair-link (`StairTriggerTracker#mark`) -- for the traversal completion
   * frame's own teleport-onto-landing arrival, which has no use for a match
   * result it would only discard.
   */
  markStairArrival(floorIndex: number, x: number, y: number): void;
  dispose(): void;
}

/**
 * Multi-floor session inputs that override the single-fixture-floor default
 * built from `data` below -- the authored-load path's shape
 * (`AuthoredMapResult`, see `authored-map.ts`). `data` itself still supplies
 * the PRIMARY floor's map/tileset/textures/sheetPixelSizes for scene-setup
 * concerns that only ever look at one floor (initial light positioning) plus
 * the (still DEV-fixture, per this slice's scope) `characterTexture` -- only
 * `createMapSession`'s own floor/stair/spawn arguments come from here.
 */
interface SessionOverride {
  readonly floorSources: readonly FloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: FloorSpawn | undefined;
}

/**
 * Multi-map navigation inputs (rpgm-whole-game-import): when present and
 * `manifest.maps.length > 1`, the 'g' key cycles through every converted map
 * in the game instead of the DEV-only fixture/giant/mz/floors cycle (see the
 * `import.meta.env.DEV && !manifestNav` gate below) -- production-safe,
 * unlike that DEV cycle, since a real game's own maps are real content, not
 * a synthetic stress test.
 */
interface ManifestNav {
  readonly manifest: GameManifest;
  readonly loadEntry: (relativeFile: string) => Promise<AuthoredMapResult | null>;
}

async function renderFixtureMap(
  container: HTMLElement,
  data: FixtureMapData,
  sessionOverride?: SessionOverride,
  manifestNav?: ManifestNav,
): Promise<void> {
  const {
    map: fixtureMap,
    tileset,
    sheetPixelSizes,
    textures,
    characterTexture,
    characterIndex: dataCharacterIndex,
  } = data;

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
   * Builds one floor's renderer state: chunk data for its whole map (pure,
   * cheap to keep), and a streaming scene that only holds GPU geometry near
   * the character. `group.position.y` is offset by `baseElevation *
   * HEIGHT_UNIT` (design: "group.position.y = baseElevation * HEIGHT_UNIT")
   * so a floor above the ground floor physically sits above it in world
   * space. Textures are shared across sessions/floors of the same source
   * (`ownsTextures: false`), so cycling back to a previously-seen map (or
   * building a second floor from the same tileset) never reloads them.
   */
  function buildFloorRender(
    source: FloorSource,
    belowRoomIdGrid: Uint16Array | undefined,
  ): {
    readonly tilemap: StreamingTilemapScene;
    readonly streamer: ChunkStreamer;
  } {
    const chunks = buildChunks(
      source.map,
      source.tileset,
      source.sheetPixelSizes,
      DEFAULT_CHUNK_SIZE,
      undefined,
      source.rampCells ?? [],
    );
    const tilemap = new StreamingTilemapScene(chunks, source.textures, {
      tileWorldSize: TILE_WORLD_SIZE,
      ownsTextures: false,
      // HD-2D convention (Octopath Traveler): the tileset environment is
      // filtered/mipmapped so it doesn't shimmer/alias under perspective
      // minification while walking; the character sprite (loaded separately,
      // see `loadFixtureMapData`) keeps the crisp nearest/no-mipmap default.
      textureOptions: { mipmaps: true, maxAnisotropy },
      // Ceiling carve (design gotcha, obs #117): the floor BELOW's room grid
      // carves THIS floor's ground-quad tiles into per-room ceiling meshes,
      // so THIS floor's scene is the one `session.driveCeilingFade` targets
      // when the player stands in one of those rooms one floor down.
      // Constructor-only option -- there is no live "recarve" API, so a
      // change to which rooms carve a floor's ceiling requires rebuilding
      // that floor's scene from scratch (already what re-entering the
      // visibility window does).
      ...(belowRoomIdGrid
        ? { ceilingCarve: { roomIdGrid: belowRoomIdGrid, mapWidth: source.map.width } }
        : {}),
    });
    tilemap.group.position.y = source.baseElevation * HEIGHT_UNIT;
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: source.map.width,
      mapHeight: source.map.height,
      buildRadius: STREAM_BUILD_RADIUS,
      disposeRadius: STREAM_DISPOSE_RADIUS,
    });
    return { tilemap, streamer };
  }

  /**
   * Builds a fully wired session for one or more stacked floors: one
   * `FloorGameplay` (passability/elevation) and one renderer `FloorRenderSlot`
   * per source, a floor-scoped spawn tile (never hardcoded), and the
   * character's grid mover. `floorSources[0]` is the "ground"/primary floor
   * (its `map` backs `session.map` for display/camera purposes); every real
   * caller below still passes exactly one source, so behavior on Map007/mz
   * hill stays byte-identical to before this slice -- only the dev-only
   * 'floors' map-cycle mode (see below) passes more than one.
   */
  function createMapSession(
    floorSources: readonly FloorSource[],
    stairLinks: readonly StairLinkRuntime[] = [],
    options?: { readonly spawn?: FloorSpawn },
  ): MapSession {
    const primary = floorSources[0];
    if (!primary) throw new Error('createMapSession requires at least one floor source.');

    // Gameplay containers (unchanged from slice 2): one ElevationField +
    // PassabilityGrid per floor, routed by `floorRouter.currentFloor`.
    const floors = floorSources.map((source) =>
      buildFloorGameplay(
        source.floorId,
        source.baseElevation,
        source.map,
        source.tileset,
        source.rampCells ?? [],
      ),
    );
    const floorRouter = createFloorRouter(floors);

    // Renderer containers (this slice): one StreamingTilemapScene +
    // ChunkStreamer PER floor. `OcclusionFloorPolicy` (design "Ceilings and
    // Interior Occlusion") governs which floors have live render state at
    // all -- a floor outside the window is fully disposed (`render` is
    // `undefined`), not merely hidden, and is rebuilt fresh the next time it
    // enters the window (design: "re-window on swap = dispose + fresh
    // streamer.update"). Unlike the prior `WindowedFloorPolicy`, this policy
    // also includes `currentFloor + 1` (when it exists) so the floor above
    // renders opaque and occludes the exterior/upper interior; swapping back
    // to `WindowedFloorPolicy` (kept in `@threemaker/renderer` for rollback)
    // is the entire revert path.
    const floorSlots: FloorRenderSlot[] = floorSources.map((source) => ({
      source,
      render: undefined,
    }));
    const visibilityPolicy: FloorVisibilityPolicy = new OcclusionFloorPolicy();

    function applyFloorWindow(focusX: number, focusY: number, floorOverride?: number): void {
      const visible = new Set(
        visibilityPolicy.visibleFloors(
          floorOverride ?? floorRouter.currentFloor,
          floorSlots.length,
        ),
      );
      for (let i = 0; i < floorSlots.length; i++) {
        const slot = floorSlots[i];
        if (!slot) continue;
        if (visible.has(i)) {
          if (!slot.render) {
            slot.render = buildFloorRender(slot.source, floorSlots[i - 1]?.source.roomIdGrid);
            scene.add(slot.render.tilemap.group);
          }
          slot.render.tilemap.applyDiff(slot.render.streamer.update(focusX, focusY));
        } else if (slot.render) {
          scene.remove(slot.render.tilemap.group);
          slot.render.tilemap.dispose();
          slot.render = undefined;
        }
      }
    }

    function liveChunkCount(): number {
      return floorSlots.reduce((sum, slot) => sum + (slot.render?.tilemap.liveChunkCount ?? 0), 0);
    }

    // Player-current-room lookup (design "Player-current-room runtime"): one
    // grid per floor, `undefined` for a floor with no authored rooms.
    // Floors share the document's width (design: "floors share the
    // document's width/height"), so the primary floor's own width indexes
    // every floor's grid.
    const roomTracker = createRoomTracker(
      floorSources.map((source) => source.roomIdGrid),
      primary.map.width,
    );

    function roomIdAt(floorIndex: number, x: number, y: number): number {
      return roomTracker.roomAt(floorIndex, x, y);
    }

    function driveCeilingFade(floorIndex: number, roomId: number | null, dt: number): void {
      driveRoomFade(aboveFloorTilemap(floorSlots, floorIndex), roomId, dt);
    }

    // Stair-link trigger dedup: extracted to `@threemaker/gameplay`'s
    // `StairTriggerTracker` (Slice 5 gate-fix -- makes the on-arrival dedup
    // unit-testable outside main.ts). Same rationale/pattern as
    // `TriggerIndex#enter` (see its own doc comment): reporting a tile again
    // (standing still, or every frame while a chained multi-tile move holds
    // a direction key -- see `GridMover`'s own chaining behavior) is a
    // no-op, but a genuinely NEW tile always re-evaluates, even one visited
    // before. Critically, this is also what stops a traversal's own
    // completion-frame teleport onto a `bidirectional` link's landing
    // waypoint from instantly re-triggering the reverse trip the moment it
    // lands -- the game loop's completion-frame branch calls
    // `markStairArrival` (not `stairTriggerAt`) purely to mark that arrival,
    // without scanning `stairLinks` for a match it would only discard;
    // exactly like `TriggerIndex`'s own `initialTile` constructor param
    // avoids firing for a trigger the player merely spawns on top of.
    const stairTriggerTracker = new StairTriggerTracker();

    function stairTriggerAt(
      floorIndex: number,
      x: number,
      y: number,
    ): readonly StairTraversalWaypoint[] | undefined {
      return stairTriggerTracker.shouldTrigger({ floor: floorIndex, x, y }, stairLinks);
    }

    function markStairArrival(floorIndex: number, x: number, y: number): void {
      stairTriggerTracker.mark({ floor: floorIndex, x, y });
    }

    // Runtime spawn (loop-crear-jugar design): an authored spawn wins when
    // its floor is standable there; otherwise `resolveInitialSpawn` falls
    // back to `findSpawnTile`'s nearest-standable search, exactly as before
    // this option existed. `floorRouter.currentFloor` must be set to the
    // resolved floor BEFORE anything below reads it (stair-arrival marking,
    // the mover's `canMove` closure, the initial render window).
    const floorSpawn = resolveInitialSpawn(
      floors.map((floor) => floor.passability),
      options?.spawn,
      primary.map.width / 2,
      primary.map.height / 2,
    );
    floorRouter.currentFloor = floorSpawn.floorIndex;
    const spawn = { x: floorSpawn.x, y: floorSpawn.y };
    // Spawning exactly on a stair-link waypoint (unlikely, but possible on a
    // hand-authored map) should not immediately trigger a traversal --
    // matches `TriggerIndex`'s own initialTile convention.
    markStairArrival(floorRouter.currentFloor, spawn.x, spawn.y);
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
      // other maps. `floorRouter.passability` routes to the mover's
      // `currentFloor`.
      canMove: (x, y, direction) => {
        if (!floorRouter.passability.canMove(x, y, direction)) return false;
        if (!demoMapActive || !npcRegistry) return true;
        const delta = DIRECTION_DELTA[direction];
        return !npcRegistry.occupies(x + delta.x, y + delta.y);
      },
    });

    // Build the spawn surroundings, for every floor the initial window
    // covers, before the first frame renders.
    applyFloorWindow(spawn.x, spawn.y);

    return {
      map: primary.map,
      mover,
      spawn,
      floorRouter,
      liveChunkCount,
      applyFloorWindow,
      roomIdAt,
      driveCeilingFade,
      stairTriggerAt,
      markStairArrival,
      dispose() {
        for (const slot of floorSlots) {
          if (!slot.render) continue;
          scene.remove(slot.render.tilemap.group);
          slot.render.tilemap.dispose();
          slot.render = undefined;
        }
      },
    };
  }

  let session = createMapSession(
    sessionOverride?.floorSources ?? [
      { floorId: 'floor-0', baseElevation: 0, map: fixtureMap, tileset, textures, sheetPixelSizes },
    ],
    sessionOverride?.stairLinks ?? [],
    sessionOverride?.spawn ? { spawn: sessionOverride.spawn } : undefined,
  );
  const walkAnimation = new WalkAnimation();

  // The render-position handoff selector (design "Render-position handoff"):
  // `null` = normal mover-sourced play (branch a); non-null = the walker owns
  // the character's world position and camera target for this frame (branch
  // b) -- and on the SAME tick `frame.done` first reports `true`, the
  // completion frame (branch c) also runs, since it is the tail of branch b's
  // own `if`, not a separate tick. `waypoints` is paired with `walker` here
  // (one nullable object, not two separately-nulled variables, so nothing can
  // set/clear one half without the other) -- needed at the completion frame
  // (exit cell + facing + destination floor) and every frame in between (the
  // `max(fromFloor, toFloor)` render-window pin), since `StairTraversal`
  // itself doesn't expose them.
  let activeTraversal: {
    readonly walker: StairTraversal;
    readonly waypoints: readonly StairTraversalWaypoint[];
  } | null = null;
  // Last composed world Y actually rendered this frame (mover-sourced
  // `groundYAt` in branch a, or the walker's own `worldY` in branch b) --
  // exposed via `window.__threemaker_debug.worldY` so a headless check can
  // assert it rises/falls across a floor transition.
  let lastGroundY = 0;

  const character = new CharacterSprite({
    texture: characterTexture,
    sheetColumns: CHARACTER_SHEET_COLUMNS,
    sheetRows: CHARACTER_SHEET_ROWS,
    characterIndex: dataCharacterIndex ?? CHARACTER_INDEX,
    tileWorldSize: TILE_WORLD_SIZE,
  });
  character.setTilePosition(
    session.mover.renderPosition.x,
    session.mover.renderPosition.y,
    TILE_WORLD_SIZE,
    groundYAt(
      session.floorRouter.elevation,
      session.mover.tile.x,
      session.mover.tile.y,
      HEIGHT_UNIT,
      session.floorRouter.baseElevation,
    ),
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
      groundYAt(
        session.floorRouter.elevation,
        session.spawn.x,
        session.spawn.y,
        HEIGHT_UNIT,
        session.floorRouter.baseElevation,
      ),
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
      liveChunks: session.liveChunkCount(),
      drawCalls: renderer.info.render.drawCalls,
      tile: { x: session.mover.tile.x, y: session.mover.tile.y },
      elevation: session.floorRouter.elevation.heightAt(session.mover.tile.x, session.mover.tile.y),
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
        return session.liveChunkCount();
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
        return session.floorRouter.elevation.surfaceHeightAt(
          session.mover.renderPosition.x,
          session.mover.renderPosition.y,
        );
      },
      // Plantas Apiladas Slice 5 (stair-link exit criterion): the active
      // floor index -- flips exactly once per traversal, at the completion
      // frame (never mid-climb) -- and the composed world Y actually
      // rendered this frame, so a headless check can assert both the floor
      // flip and a continuous rise/fall across the transition.
      get currentFloor() {
        return session.floorRouter.currentFloor;
      },
      get worldY() {
        return lastGroundY;
      },
      get traversing() {
        return activeTraversal !== null;
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
          groundYAt(session.floorRouter.elevation, npc.x, npc.y, HEIGHT_UNIT),
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
  // a painted region hill to exercise elevation) -> a 2-floor synthetic demo
  // (Plantas Apiladas slice 3: visually verifies the per-floor Y-offset and
  // the active floor-render window policy -- OcclusionFloorPolicy as of
  // "Ceilings and Interior Occlusion" -- ahead of a real authored
  // multi-floor `.tmmap`) -> back to the fixture map. Mutually exclusive
  // with the manifest multi-map cycle below (`!manifestNav`): a real
  // converted game takes over the 'g' key entirely, rather than both
  // listeners firing on the same keypress.
  if (import.meta.env.DEV && !manifestNav) {
    type MapCycleMode = 'fixture' | 'giant' | 'mz' | 'floors';
    const CYCLE_ORDER: readonly MapCycleMode[] = ['fixture', 'giant', 'mz', 'floors'];

    let mode: MapCycleMode = 'fixture';
    let giantMap: RpgmMap | undefined;
    let mzData: MapSourceData | undefined;
    let floorsDemoMaps: readonly [RpgmMap, RpgmMap] | undefined;
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
      // Same reasoning as the script guard above: disposing `session`
      // mid-traversal would strand `activeTraversal`'s `mover.teleport`
      // completion frame on an already-disposed session's mover.
      if (activeTraversal) return;
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
            session = createMapSession([
              {
                floorId: 'floor-0',
                baseElevation: 0,
                map: giantMap,
                tileset,
                textures,
                sheetPixelSizes,
              },
            ]);
          } else if (mode === 'mz') {
            mzData ??= await loadMzFixtureMapData();
            session.dispose();
            session = createMapSession([
              {
                floorId: 'floor-0',
                baseElevation: 0,
                map: mzData.map,
                tileset: mzData.tileset,
                textures: mzData.textures,
                sheetPixelSizes: mzData.sheetPixelSizes,
                rampCells: DEMO_RAMP_SEMANTICS,
              },
            ]);
          } else if (mode === 'floors') {
            // Reuses the fixture map's own tileset/textures (same convention
            // as 'giant' above) so no extra load is needed -- only the map
            // layout differs per floor (different seeds), same tileset.
            floorsDemoMaps ??= [
              generateSyntheticMap({
                width: DEV_DEMO_FLOOR_SIZE,
                height: DEV_DEMO_FLOOR_SIZE,
                seed: GIANT_MAP_SEED,
              }),
              generateSyntheticMap({
                width: DEV_DEMO_FLOOR_SIZE,
                height: DEV_DEMO_FLOOR_SIZE,
                seed: GIANT_MAP_SEED + 1,
              }),
            ];
            session.dispose();
            session = createMapSession(
              [
                {
                  floorId: 'floor-0',
                  baseElevation: 0,
                  map: floorsDemoMaps[0],
                  tileset,
                  textures,
                  sheetPixelSizes,
                  // Carves floor 1's ceiling over this room's footprint (see
                  // `buildDevDemoRooms`'s doc comment).
                  roomIdGrid: computeRoomIdGrid(
                    buildDevDemoRooms(),
                    'floor-0',
                    DEV_DEMO_FLOOR_SIZE,
                    DEV_DEMO_FLOOR_SIZE,
                  ),
                },
                {
                  floorId: 'floor-1',
                  baseElevation: DEV_DEMO_FLOOR_HEIGHT,
                  map: floorsDemoMaps[1],
                  tileset,
                  textures,
                  sheetPixelSizes,
                },
              ],
              buildDevDemoStairLinks(),
            );
            // Starts on floor 0's own spawn (createMapSession's default
            // `currentFloor = 0`), unlike Slice 3's own version of this mode
            // (which force-jumped to floor 1 purely to visually check the
            // window/Y-offset ahead of real traversal wiring) -- Slice 5's
            // stair-link is the real way up now: walk onto
            // `(DEV_DEMO_STAIR_ENTRY_X, DEV_DEMO_STAIR_ROW)` to climb.
          } else {
            session.dispose();
            session = createMapSession([
              {
                floorId: 'floor-0',
                baseElevation: 0,
                map: fixtureMap,
                tileset,
                textures,
                sheetPixelSizes,
              },
            ]);
          }
          focusCameraOnSpawn();

          // The demo NPCs/triggers are authored against the fixture map's
          // own tile coordinates -- irrelevant (and potentially
          // out-of-bounds) on the giant/mz/floors maps, so hide the NPC
          // billboards and stop routing interact/enter input to them while
          // cycled away.
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

  // Manifest multi-map cycle (rpgm-whole-game-import): 'g' walks forward
  // through every map `convert-rpgm-game` produced for the current game,
  // wrapping back to the first. Production-safe (no `import.meta.env.DEV`
  // gate) -- these are the game's own real converted maps, not a synthetic
  // dev demo. Mutually exclusive with the DEV fixture-cycle block above
  // (`manifestNav` is only ever passed when this branch should own 'g').
  if (manifestNav && manifestNav.manifest.maps.length > 1) {
    let currentMapIndex = 0;
    let cyclingManifestMap = false;

    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.key.toLowerCase() !== 'g' || cyclingManifestMap) return;
      // Same guards as the DEV cycle above: never dispose `session` mid-script
      // or mid-traversal.
      if (interpreter && interpreter.state !== 'idle') return;
      if (activeTraversal) return;
      cyclingManifestMap = true;
      void (async () => {
        try {
          const maps = manifestNav.manifest.maps;
          const nextIndex = (currentMapIndex + 1) % maps.length;
          const nextEntry = maps[nextIndex];
          if (!nextEntry) return;

          const nextResult = await manifestNav.loadEntry(nextEntry.file);
          if (!nextResult) {
            console.error(
              `Failed to load manifest map "${nextEntry.file}" -- staying on the current map.`,
            );
            return;
          }

          currentMapIndex = nextIndex;
          session.dispose();
          session = createMapSession(
            nextResult.floorSources,
            nextResult.stairLinks,
            nextResult.spawn ? { spawn: nextResult.spawn } : undefined,
          );
          focusCameraOnSpawn();
        } catch (error) {
          console.error('Failed to cycle to the next manifest map:', error);
        } finally {
          cyclingManifestMap = false;
        }
      })();
    });
  }

  // Custom clock, not `THREE.Clock` (deprecated since three r183) -- reuses
  // the engine's own game loop from `@threemaker/core`.
  /**
   * Moves the character/camera to `position` and closes the exponential
   * camera-follow step -- the shared tail of every per-frame source
   * (mover-sourced or walker-sourced). `position` is a single object, not
   * three positional numbers -- `x`/`y`/`worldY` are all plain `number`s, so
   * passing them positionally would let a caller swap two of them without a
   * type error; `Pick<StairTraversalFrame, 'x' | 'y' | 'worldY'>` matches the
   * shape both call sites already have in scope (the walker-frame branch
   * passes its `StairTraversalFrame` directly; the mover-frame branch builds
   * the matching object from `mover.renderPosition` + the composed
   * `groundY`).
   */
  function renderCharacterAt(
    position: Pick<StairTraversalFrame, 'x' | 'y' | 'worldY'>,
    facing: Direction,
    moving: boolean,
    dt: number,
  ): void {
    const { x, y, worldY } = position;
    lastGroundY = worldY;
    character.setFrame(facing, walkAnimation.frameColumn(moving));
    character.setTilePosition(x, y, TILE_WORLD_SIZE, worldY);
    character.faceCamera(camera);

    // Framerate-independent exponential smoothing: the camera closes a
    // fixed fraction of the remaining distance per second, regardless of
    // how `dt` is chopped into frames.
    const desiredX = tileCenterToWorld(x, TILE_WORLD_SIZE);
    const desiredZ = tileCenterToWorld(y, TILE_WORLD_SIZE);
    const followAmount = 1 - Math.exp(-CAMERA_FOLLOW_SPEED * dt);
    target.x += (desiredX - target.x) * followAmount;
    target.y += (worldY - target.y) * followAmount;
    target.z += (desiredZ - target.z) * followAmount;
    applyCameraPose();
  }

  const gameLoop = new GameLoop({
    onTick(dt) {
      const { mover } = session;

      // (b) During traversal: the walker owns render position + camera
      // target for every frame of the climb/descent (design "Render-position
      // handoff", branch b) -- `mover.update` is never called here, so
      // `currentFloor`/the mover's tile stay frozen mid-traversal (the
      // invariant: both mutate ONLY at the completion frame, below).
      if (activeTraversal) {
        const { walker, waypoints } = activeTraversal;
        const frame = walker.update(dt);
        const first = waypoints[0];
        const last = waypoints[waypoints.length - 1];
        const pinnedFloor = Math.max(first?.floor ?? 0, last?.floor ?? 0);
        session.applyFloorWindow(frame.x, frame.y, pinnedFloor);
        // (design branch (b): "During traversal: setFadedRoom(null)") -- no
        // room reads as "current" mid-climb, so the pinned floor's ceiling
        // (if any) fades back to opaque instead of holding whatever room was
        // faded the instant the climb started.
        session.driveCeilingFade(pinnedFloor, null, dt);

        walkAnimation.update(dt);
        renderCharacterAt(frame, mover.facing, true, dt);

        // (c) Completion frame: fires on THIS SAME tick, the instant
        // `frame.done` first reports true -- not a separate tick after (b).
        // The walker's last act is `mover.teleport(exitCell, facing)` with
        // `currentFloor` flipped to the destination BEFORE `activeTraversal`
        // clears (design invariant) -- the NEXT tick resumes branch (a), now
        // mover-sourced on the destination floor, with no camera/position pop
        // (the walker's final `worldY` already equals that floor's own
        // `groundYAt` at the landing cell, since both use the same composed
        // formula).
        if (frame.done && last) {
          const previous = waypoints[waypoints.length - 2] ?? first;
          const facing = (previous && directionBetween(previous, last)) ?? mover.facing;
          mover.teleport(last.x, last.y, facing);
          session.floorRouter.currentFloor = last.floor;
          activeTraversal = null;
          session.applyFloorWindow(last.x, last.y);
          // Marks the landing tile as already-checked (see
          // `StairTriggerTracker#mark`'s doc comment) so this SAME teleported
          // arrival doesn't instantly re-trigger a bidirectional link's
          // reverse trip the very next frame -- the player must actually
          // walk away and back onto it for that. Uses `mark`, not
          // `stairTriggerAt`, since this call has no use for a match result
          // it would only discard.
          session.markStairArrival(last.floor, last.x, last.y);
        }
        return;
      }

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

      // Stair-link auto-trigger (design "Stair trigger": auto-on-step onto
      // an entry waypoint): reported every tick against `mover.tile` --
      // ALWAYS the last fully-settled integer tile, never a mid-step
      // fractional position -- exactly like `triggerIndex.enter` just below.
      // `session.stairTriggerAt` internally dedups on-arrival (see
      // `StairTriggerTracker`), so a continuously-held direction key that
      // chains through several tiles per call (see `GridMover`'s own
      // chaining behavior) still only fires once per NEW tile, not once per
      // frame spent standing on it. Only ever finds a match when
      // `session.stairTriggerAt` was built with `stairLinks` (today, only
      // the dev 'floors' demo) -- every other map's `stairLinks` is empty,
      // so this is a no-op there.
      const stairWaypoints = session.stairTriggerAt(
        session.floorRouter.currentFloor,
        mover.tile.x,
        mover.tile.y,
      );
      if (stairWaypoints) {
        const floors: readonly StairTraversalFloor[] = session.floorRouter.floors.map((floor) => ({
          baseElevation: floor.baseElevation,
          elevation: floor.elevation,
        }));
        activeTraversal = {
          walker: new StairTraversal({
            waypoints: stairWaypoints,
            floors,
            speed: PLAYER_SPEED,
            heightUnit: HEIGHT_UNIT,
          }),
          waypoints: stairWaypoints,
        };
      }

      if (demoMapActive && interpreter && triggerIndex && demoEvents) {
        for (const eventId of triggerIndex.enter(mover.tile.x, mover.tile.y)) {
          interpreter.run(demoEvents[eventId] ?? []);
        }
      }

      for (const sprite of npcSprites.values()) sprite.faceCamera(camera);

      // Cheap per-frame streaming check: each floor's `ChunkStreamer.update`
      // early-exits with an empty diff while the character stays inside the
      // same chunk, so geometry work only happens on chunk-boundary
      // crossings; floors outside the current window are skipped entirely.
      session.applyFloorWindow(mover.tile.x, mover.tile.y);

      // Ceiling fade drive (design "Player-current-room runtime"): resolves
      // the room under the player's just-settled tile, gates it through the
      // camera mode (`resolveFadedRoomId` -- 'first-person' always fades
      // nothing, the player is under the ceiling and it must stay solid),
      // then drives the floor-ABOVE's scene, whose carved ceiling meshes
      // represent this floor's rooms (obs #117 gotcha).
      const currentRoomId = session.roomIdAt(
        session.floorRouter.currentFloor,
        mover.tile.x,
        mover.tile.y,
      );
      session.driveCeilingFade(
        session.floorRouter.currentFloor,
        resolveFadedRoomId(cameraMode, currentRoomId),
        dt,
      );

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
        session.floorRouter.elevation,
        mover.renderPosition.x,
        mover.renderPosition.y,
        HEIGHT_UNIT,
        session.floorRouter.baseElevation,
      );

      renderCharacterAt(
        { x: mover.renderPosition.x, y: mover.renderPosition.y, worldY: groundY },
        mover.facing,
        mover.moving,
        dt,
      );
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

  // Authored-load path (loop-crear-jugar, Slice 4a/4b): gated on the real
  // Tauri host being present (both `tauri dev` and a production build), NOT
  // on `import.meta.env.DEV` -- an authored map renders the same way in
  // either. `loadAuthoredMap` returns `null` (after logging why) for "no
  // file saved yet"/parse failure/read failure, all of which fall through
  // to the DEV demos/fixture path below, unchanged (spec: "DEV demos remain
  // fallback"). The player-sprite character sheet is `character-sprite-
  // placeholder.ts`'s canvas-generated (in-memory, no fs/network) sheet --
  // Slice 4b replaced the DEV-only Roseliam fixture 4a used here, so this
  // branch no longer depends on `/@fs/`/`__FIXTURES_DIR__` at all.
  if (isTauriAvailable()) {
    // Multi-map (manifest-driven) authored path (rpgm-whole-game-import):
    // takes priority over the single-file authored path below when
    // `convert-rpgm-game`'s manifest exists and lists at least one map.
    // Falls through to the single-file path unchanged on any failure here
    // (no manifest saved yet, a malformed manifest, or the first map itself
    // failing to load/render) -- exactly the same fail-soft layering the
    // single-file path already has relative to the DEV fixture below.
    let manifest: GameManifest | undefined;
    try {
      const manifestText = await readManifestText();
      if (manifestText !== null) manifest = parseGameManifest(JSON.parse(manifestText));
    } catch (error) {
      console.error(
        'main: the map manifest failed to parse/validate; falling back to the single authored map.',
        error,
      );
    }

    const firstEntry = manifest?.maps[0];
    if (manifest && firstEntry) {
      try {
        const authored = await loadAuthoredMapAt(firstEntry.file);
        if (!authored) {
          throw new Error(`loadAuthoredMap returned null for manifest entry "${firstEntry.file}".`);
        }
        const primaryFloor = authored.floorSources[0];
        if (!primaryFloor) throw new Error('loadAuthoredMap returned no floors.');

        const { texture: characterTexture, characterIndex } = await resolvePlayerCharacterTexture(
          manifest.actorSheet,
        );
        statusEl.remove();
        await renderFixtureMap(
          container,
          {
            map: primaryFloor.map,
            tileset: primaryFloor.tileset,
            sheetPixelSizes: primaryFloor.sheetPixelSizes,
            textures: primaryFloor.textures,
            characterTexture,
            ...(characterIndex !== undefined ? { characterIndex } : {}),
          },
          {
            floorSources: authored.floorSources,
            stairLinks: authored.stairLinks,
            spawn: authored.spawn,
          },
          { manifest, loadEntry: loadAuthoredMapAt },
        );
        return;
      } catch (error) {
        console.error(
          'main: manifest map load/render failed; falling back to the single authored map.',
          error,
        );
      }
    }

    const authored = await loadAuthoredMap();
    if (authored) {
      const primaryFloor = authored.floorSources[0];
      if (!primaryFloor) throw new Error('loadAuthoredMap returned no floors.');
      try {
        const characterTexture = buildPlaceholderCharacterTexture();
        statusEl.remove();
        await renderFixtureMap(
          container,
          {
            map: primaryFloor.map,
            tileset: primaryFloor.tileset,
            sheetPixelSizes: primaryFloor.sheetPixelSizes,
            textures: primaryFloor.textures,
            characterTexture,
          },
          {
            floorSources: authored.floorSources,
            stairLinks: authored.stairLinks,
            spawn: authored.spawn,
          },
        );
        return;
      } catch (error) {
        console.error('Authored map loaded, but rendering it failed:', error);
        statusEl.textContent = i18n.t('map.fixtureNotFound');
        return;
      }
    }
  }

  // `/@fs/` and `server.fs.allow` (vite.config.ts) only exist under `vite
  // dev` -- a production build has no dev server to serve the (git-ignored,
  // never-shipped) DEV-demo fixture from. At this point no authored map was
  // found either (the branch above already returned if one was), so the
  // accurate message is "no authored map found", not "fixture not found" --
  // production has no fixture concept at all.
  if (!import.meta.env.DEV) {
    statusEl.textContent = i18n.t('map.noAuthoredMap');
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
