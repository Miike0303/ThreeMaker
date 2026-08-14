import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import type { EventHost } from '@threemaker/core';
import { GameLoop, WorldClock } from '@threemaker/core';
import type {
  Direction,
  StairTraversalFloor,
  StairTraversalFrame,
  StairTraversalWaypoint,
} from '@threemaker/gameplay';
import {
  DIRECTION_DELTA,
  GridMover,
  Inventory,
  parseGameDefsJson,
  routinePositionAt,
  StairTraversal,
  StairTriggerTracker,
  StatBlock,
} from '@threemaker/gameplay';
import type { RampCellInput, RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import type { ActionBinding, BindingTable, PointerSample } from '@threemaker/input';
import {
  Actions,
  createGamepadTracker,
  directionFromMoveAction,
  isMoveAction,
  rebindKeyboard,
  resolvePointerIntent,
  snapshotFromGamepads,
} from '@threemaker/input';
import type { LightDocument, PropDocument, RoomDocument } from '@threemaker/map-format';
import { computeRoomIdGrid } from '@threemaker/map-format';
import type {
  CameraMode,
  FloorVisibilityPolicy,
  MapLightsBundle,
  MapPropsBundle,
  SheetPixelSizes,
  WeatherMode,
} from '@threemaker/renderer';
import {
  baseSceneLightSetup,
  buildChunks,
  buildMapLights,
  buildMapProps,
  buildSheetLightingOptions,
  ChunkStreamer,
  CLOCK_MINUTES_KEY,
  clampRange,
  clampTiltDeg,
  composeAmbientIntensity,
  computeCameraPose,
  createHd2dPipeline,
  createWeatherLayer,
  cycleCameraMode,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_HD2D_KNOBS,
  dayNightAmbientFactor,
  generateSyntheticMap,
  groundYAt,
  LIGHT_BUDGET,
  loadSheetTexture,
  mapHasAuthoredLights,
  OcclusionFloorPolicy,
  parseWeatherMode,
  resyncClockFromWorldValue,
  StreamingTilemapScene,
  TILE_SIZE_PX,
  tickSessionClock,
  WEATHER_KEY,
  weatherDimFactor,
} from '@threemaker/renderer';
import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';
import type { AuthoredMapNarrative, AuthoredMapResult, GameDefsCatalog } from './authored-map.js';
import { EMPTY_GAME_DEFS_CATALOG, loadAuthoredMap } from './authored-map.js';
import {
  CharacterSprite,
  DEFAULT_SHEET_COLUMNS,
  DEFAULT_SHEET_ROWS,
  tileCenterToWorld,
} from './character-sprite.js';
import { buildPlaceholderCharacterTexture } from './character-sprite-placeholder.js';
import type { DebugSnapshot } from './debug-panel.js';
import { createDebugPanel } from './debug-panel.js';
import { createDialogueOverlay, nextHighlightedIndex } from './dialogue-ui.js';
import {
  fixtureCharacterUrl,
  fixtureImageUrl,
  fixtureJsonUrl,
  mzFixtureJsonUrl,
} from './fixture-paths.js';
import type { FloorRouter, FloorSource, StairLinkRuntime } from './floor-runtime.js';
import { buildFloorGameplay, createFloorRouter } from './floor-runtime.js';
import { disposeFloorTextures } from './floor-textures.js';
import type { GameManifest } from './game-manifest.js';
import { parseGameManifest } from './game-manifest.js';
import {
  applyGameSaveSessionStores,
  applyGameSaveStoryStates,
  resolveMapFileInCatalog,
  sameMapLoadNarrativeArrival,
  validateSavePlacement,
} from './game-save-apply.js';
import { captureGameSaveSnapshot } from './game-save-capture.js';
import { canLoadGameProgress, canSaveGameProgress } from './game-save-gate.js';
import { loadGameSaveSnapshot, persistGameSaveSnapshot } from './game-save-store.js';
import type { GameplayKeyAction } from './gameplay-input.js';
import { resolveGameplayAction, resolveGameplayKeyAction } from './gameplay-input.js';
import { createHopStats, recordHopCompleted } from './hop-stats.js';
import type { Locale } from './i18n.js';
import { createI18n } from './i18n.js';
import {
  createDefaultInputBindingTable,
  loadInputBindingTable,
  saveInputBindingTable,
} from './input-bindings-store.js';
import {
  MAP_DIR_RELATIVE,
  MAP_FILE_RELATIVE,
  readManifestText,
  readMapDocumentText,
} from './map-file.js';
import {
  decideTransferMapHost,
  isMapCycleKey,
  planManifestHop,
  planNextManifestCycle,
  resolveHopArrival,
} from './map-hop.js';
import type { MapNarrativeBundle, RoutineMove } from './map-narrative-bundle.js';
import { applyRoutinesIfIdle, buildMapNarrativeBundle } from './map-narrative-bundle.js';
import { isAuthoredResultPlayable } from './map-playability.js';
import { createNarrativeRoot } from './narrative-root.js';
import { withNoclip } from './noclip.js';
import { pointerTargetFromDialogueHit } from './pointer-host.js';
import {
  mapRendererBackendName,
  shouldForceWebGL,
  smoothFrameTimeMs,
} from './renderer-observability.js';
import {
  aboveFloorTilemap,
  createRoomTracker,
  driveRoomFade,
  resolveFadedRoomId,
} from './room-state.js';
import type { FloorSpawn } from './spawn.js';
import { resolveInitialSpawn } from './spawn.js';
import { isTauriAvailable } from './tauri-env.js';
import { resolveViewKeyAction } from './view-input.js';
import { WalkAnimation } from './walk-animation.js';
import { createMostRecentHeldDirection } from './walk-input.js';
import {
  homeMapsPathToWebRelative,
  webReadTextFile,
  webResolveObjectBinary,
  webResolveObjectTexture,
} from './web-game-source.js';

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

/**
 * Fog-mode densification vs HD-2D knob defaults (C8). Applied via `setFog`
 * uniforms — never by rebuilding fogNode.
 */
const FOG_MODE_NEAR_SCALE = 0.35;
const FOG_MODE_FAR_SCALE = 0.45;

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
 * Active content source for authored maps/assets (C9 WU-01).
 * - `tauri`: `$HOME/.threemaker/...` via plugin-fs (desktop shell).
 * - `web`: static `game/` payload next to the Vite bundle (browser build).
 * Set once at boot before any load; hop/narrative/props resolvers close over
 * the same functions so a web session stays on the web source.
 */
let activeGameSource: 'tauri' | 'web' = 'tauri';

/** Text under the maps tree (map JSON, ink sidecars, game-defs, manifest). */
async function readActiveMapText(homeRelativePath: string): Promise<string | null> {
  if (activeGameSource === 'web') {
    return webReadTextFile(homeMapsPathToWebRelative(homeRelativePath));
  }
  return readMapDocumentText(homeRelativePath);
}

async function readActiveManifestText(): Promise<string | null> {
  if (activeGameSource === 'web') {
    return webReadTextFile('manifest.json');
  }
  return readManifestText();
}

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
 *
 * Web source (C9): delegates to `webResolveObjectTexture` (fetch + same blob
 * decode path) so hops/NPC sheets stay playable without Tauri.
 */
async function resolveObjectTextureReal(sha256: string): Promise<ResolvedObjectTexture> {
  if (activeGameSource === 'web') {
    return webResolveObjectTexture(sha256);
  }
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
 * Reads one asset-store object's raw bytes (glTF/glb props). Same path
 * convention as `resolveObjectTextureReal` (`objects/{sha256[:2]}/{sha256}`)
 * but WITHOUT the PNG blob/decode step — the props runtime parses the bytes
 * via `GLTFLoader.parse`.
 */
async function resolveObjectBinaryReal(sha256: string): Promise<Uint8Array> {
  if (activeGameSource === 'web') {
    return webResolveObjectBinary(sha256);
  }
  const bytes = await readFile(`${ASSET_STORE_OBJECTS_DIR}/${sha256.slice(0, 2)}/${sha256}`, {
    baseDir: BaseDirectory.Home,
  });
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Loads one manifest-entry map (multi-map navigation): same
 * `loadAuthoredMap` pipeline the single-file authored path uses, but reading
 * a specific file under `.threemaker/maps` (`relativeFile`, e.g.
 * `"kingdom-of-subversion/map007.tmmap.json"`) instead of the shared
 * `current.tmmap.json`. `loadAuthoredMap`'s own signature/behavior is
 * unchanged -- this only supplies a differently-scoped `readMapDocumentText`
 * plus the matching `mapRelativePath`.
 *
 * `mapRelativePath` is optional in type only (see `AuthoredMapDeps`): it is the
 * base every `<map>.<storyId>.ink` sidecar path is derived from (design D7), so
 * omitting it here would send a manifest map looking for its sidecars next to
 * the shared `current.tmmap.json` instead of next to itself -- a "no sidecar
 * exists" failure naming the wrong directory.
 */
function loadAuthoredMapAt(
  relativeFile: string,
  gameDefsCatalog: GameDefsCatalog = EMPTY_GAME_DEFS_CATALOG,
): Promise<AuthoredMapResult | null> {
  const mapRelativePath = `${MAP_DIR_RELATIVE}/${relativeFile}`;
  return loadAuthoredMap({
    mapRelativePath,
    readMapDocumentText: () => readActiveMapText(mapRelativePath),
    readSidecarText: readActiveMapText,
    resolveObjectTexture: resolveObjectTextureReal,
    gameDefsCatalog,
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

/**
 * Simulated minutes advanced per real second (C7 world clock).
 * 2.5 → a 24-minute real-time day (1440 / 2.5 = 576 s). Knob-style constant
 * for live tuning without a settings UI yet.
 */
const CLOCK_MINUTES_PER_REAL_SECOND = 2.5;

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
  /**
   * This map's cross-validated authored narrative, or `undefined` when it
   * authors none (spec R5). Required, never optional, for the same reason
   * `AuthoredMapResult.narrative` is: an authored entry point that forgot to
   * forward it would silently boot a narrative-free map.
   */
  readonly narrative: AuthoredMapNarrative | undefined;
  /**
   * Validated schema-v5 props for this map (empty when none). Required so a
   * caller cannot drop them silently — same discipline as `narrative`.
   */
  readonly props: readonly PropDocument[];
  /**
   * Validated schema-v6 lights for this map (empty when none). Required so a
   * caller cannot drop them silently — same discipline as `props`.
   */
  readonly lights: readonly LightDocument[];
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
  /**
   * Index into `manifest.maps` this session was actually built from. Not
   * always `0`: `main()` skips forward past any leading map that isn't
   * playable (see `findFirstPlayableManifestMap`) -- a real RPG Maker
   * project's very first map is very often an unused/placeholder map with
   * no standable tile anywhere. The 'g' cycle below must start counting
   * from HERE, not from `0`, or its first press would just re-discover the
   * same skipped-over map(s).
   */
  readonly startIndex: number;
}

/**
 * Session inventory/stats for {@link renderFixtureMap}. Built once at boot
 * from optional game-defs; empty Inventory + empty StatBlock when no defs.
 * Survives map hops because the narrative root holds the same instances.
 */
interface SessionNarrativeStores {
  readonly inventory: Inventory;
  readonly stats: StatBlock;
}

async function renderFixtureMap(
  container: HTMLElement,
  data: FixtureMapData,
  sessionOverride?: SessionOverride,
  manifestNav?: ManifestNav,
  sessionStores?: SessionNarrativeStores,
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

  // Base scene lights: unlit maps keep today's directional+ambient (props only
  // until tiles also opt into lit). Lit maps (authored lights) swap ambient to
  // white at Math.PI and zero the directional — see baseSceneLightSetup.
  const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
  directionalLight.position.set(fixtureMap.width * 0.3, 20, fixtureMap.height * 0.2);
  const ambientLight = new THREE.AmbientLight(0x404060, 2);
  scene.add(directionalLight, ambientLight);
  /** Opt-in lit tile materials for the active map (`doc.lights.length > 0`). */
  let sessionLitTiles = mapHasAuthoredLights(sessionOverride?.lights ?? []);
  function applyBaseSceneLights(hasLights: boolean): void {
    sessionLitTiles = hasLights;
    const setup = baseSceneLightSetup(hasLights);
    ambientLight.color.setHex(setup.ambient.color);
    ambientLight.intensity = setup.ambient.intensity;
    if (setup.directional) {
      directionalLight.color.setHex(setup.directional.color);
      directionalLight.intensity = setup.directional.intensity;
    } else {
      // Zero rather than remove: hop reverse (lit → unlit) just restores intensity.
      directionalLight.intensity = 0;
    }
  }
  /**
   * Session weather mode (C8). Updated by `applyWeather` on world signal and
   * after save load. Read by `applyDayNightAmbient` for the weather dim factor.
   */
  let currentWeather: WeatherMode = 'clear';

  /**
   * Particle mesh + fog densify. Assigned after the session weather layer and
   * HD-2D pipeline exist; `applyWeather` only runs from world signals / save
   * load (both after boot wiring).
   */
  let weatherVisualHook: (mode: WeatherMode) => void = () => {
    /* assigned after weatherLayer + hd2d */
  };

  /**
   * Multiplies the CURRENT base setup's ambient (and non-zero directional)
   * intensity by day/night × weather dim factors. Does NOT touch
   * `sessionLitTiles` or materials. Known ceiling: the curve is global —
   * interiors with authored lamps also dim at night; per-map opt-out is deferred.
   * Weather factor reads the session `currentWeather` variable.
   */
  function applyDayNightAmbient(minutes: number): void {
    const dayNight = dayNightAmbientFactor(minutes);
    const weather = weatherDimFactor(currentWeather);
    const setup = baseSceneLightSetup(sessionLitTiles);
    ambientLight.intensity = composeAmbientIntensity(setup.ambient.intensity, dayNight, weather);
    if (setup.directional) {
      directionalLight.intensity = composeAmbientIntensity(
        setup.directional.intensity,
        dayNight,
        weather,
      );
    }
  }
  applyBaseSceneLights(sessionLitTiles);

  // Created (and initialized) before any map session so `getMaxAnisotropy()`
  // is available up front -- every session's tileset materials use it for
  // the HD-2D filtered-environment texture configuration (see
  // `createMapSession` below and `PixelArtTextureOptions`).
  // Dev toggle to verify the WebGL2 floor (`?webgl=1` → forceWebGL).
  const forceWebGL = shouldForceWebGL(typeof location !== 'undefined' ? location.search : '');
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    ...(forceWebGL ? { forceWebGL: true } : {}),
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  await renderer.init();
  const maxAnisotropy = renderer.getMaxAnisotropy();
  // three r184: after init(), `renderer.backend` is WebGPUBackend or WebGLBackend.
  const rendererBackend = mapRendererBackendName(renderer.backend);
  /** EMA frame time (ms); updated in the animation loop — no stats-gl dependency. */
  let frameTimeMsEma = 0;
  let lastFrameStampMs = performance.now();

  /**
   * Builds one floor's renderer state: chunk data for its whole map (pure,
   * cheap to keep), and a streaming scene that only holds GPU geometry near
   * the character. `group.position.y` is offset by `baseElevation *
   * HEIGHT_UNIT` (design: "group.position.y = baseElevation * HEIGHT_UNIT")
   * so a floor above the ground floor physically sits above it in world
   * space. `ownsTextures: false`: this scene never disposes `source.textures`
   * itself, on the assumption the CALLER owns their lifetime. That holds for
   * the DEV fixture/giant/mz/floors cycle below (each mode's map data,
   * `textures` included, is cached at module/closure scope, so cycling back
   * to a previously-seen mode reuses the same texture instances and never
   * reloads them) -- but NOT for the manifest map-cycle (rpgm-whole-game-import):
   * that one calls `loadAuthoredMap` fresh per hop, which allocates a brand
   * new `textures` set every time, and disposes the outgoing set itself via
   * `disposeFloorTextures` (see that block below) precisely because nothing
   * else would.
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
      source.tilePixelSize ?? TILE_SIZE_PX,
    );
    // C6 WU-04: lit tiles when the map authors lights; lightMap still optional.
    // Seam: buildSheetLightingOptions(sessionLitTiles, lightMapTexture).
    const lighting = buildSheetLightingOptions(sessionLitTiles, source.lightMapTexture);
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
      ...(lighting ? { lighting } : {}),
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

  // Ctrl noclip debug mode (rpgm-whole-game-import, user-requested): held
  // while `true`, `withNoclip` (below, in the mover's `canMove`) bypasses
  // passability entirely. Declared here (before `createMapSession`) so its
  // closure captures this SAME binding across every session rebuild (map
  // cycling creates a fresh `mover`/`canMove` closure each time, but noclip
  // state itself should persist across that rebuild, not reset to off).
  let noclipActive = false;

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
      // NPC collision is added at this callsite. `bundle` is declared later in
      // this function (narrative wiring, below) but already resolved by the
      // time this closure is ever invoked (first call happens from the game
      // loop, well after setup completes), and it is `undefined` for a map that
      // authors no NPCs at all (spec R5), which is what makes the collision
      // check disappear rather than be flag-gated.
      // `floorRouter.passability` routes to the mover's
      // `currentFloor`. `withNoclip` wraps the whole thing (including NPC
      // collision) so holding Ctrl bypasses both terrain AND NPC blocking;
      // its own escape-hatch `isStandable` check is a thin passthrough
      // (not `floorRouter.passability` captured once) so it re-resolves
      // `floorRouter`'s CURRENT floor on every call too, exactly like the
      // inner `canMove` callback below -- a stair traversal changing floors
      // must never leave this pinned to a stale, already-left floor.
      canMove: withNoclip(
        () => noclipActive,
        { isStandable: (x, y) => floorRouter.passability.isStandable(x, y) },
        (x, y, direction) => {
          if (!floorRouter.passability.canMove(x, y, direction)) return false;
          if (!bundle) return true;
          const delta = DIRECTION_DELTA[direction];
          // Floor-scoped like `floorRouter.passability` above: an NPC standing
          // on another floor's same `(x, y)` must never block movement here.
          return !bundle.npcRegistry.occupies(floorRouter.currentFloor, x + delta.x, y + delta.y);
        },
      ),
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
  /** Session-lived hop counters for the debug panel (C1b leak observability). */
  let hopStats = createHopStats();
  /**
   * Per-map narrative bundle. Declared BEFORE `buildDebugSnapshot` / the first
   * `debugPanel.update` so those closures do not hit a TDZ `ReferenceError` on
   * `bundle` (live boot regression: every authored/manifest map failed with
   * "Cannot access 'bundle' before initialization"). Still assigned later when
   * narrative wiring attaches; until then it stays `undefined` and `bundle?.`
   * reads are safe.
   */
  let bundle: MapNarrativeBundle | undefined;
  /**
   * Per-map glTF props bundle (C5). Hoisted next to `bundle` for the same TDZ
   * reason: debug snapshot + hop dispose read it before the later wiring block
   * assigns it.
   */
  let propsBundle: MapPropsBundle | undefined;
  /**
   * Per-map authored lights bundle (C6). Hoisted next to `propsBundle` for the
   * same TDZ reason: debug snapshot, hop dispose, and `renderCharacterAt`.
   */
  let lightsBundle: MapLightsBundle | undefined;
  /**
   * Session narrative root (world + inventory + stats + clock + overlay).
   * Declared before `buildDebugSnapshot` so the debug panel can read live
   * inventory/stats/clock without a TDZ on `narrativeRoot` (same reason
   * `bundle` is early). Clock is session-scoped: survives hops, never on
   * the per-map bundle.
   */
  const sessionClock = new WorldClock({
    minutesPerRealSecond: CLOCK_MINUTES_PER_REAL_SECOND,
  });
  const narrativeRoot = createNarrativeRoot({
    // Mounting happens INSIDE the factory: the root owns the overlay's lifetime,
    // this file owns where it lives (narrative-root.ts's own doc comment). Built
    // lazily on first use, so a narrative-free session never adds it to the DOM.
    createOverlay: () => {
      const overlay = createDialogueOverlay(i18n.t);
      container.appendChild(overlay.element);
      return overlay;
    },
    clock: sessionClock,
    ...(sessionStores ? { inventory: sessionStores.inventory, stats: sessionStores.stats } : {}),
  });

  /**
   * Apply a weather mode: store session state, recompose ambient with the
   * weather dim factor, and invoke the visual hook (particles + fog uniforms).
   */
  function applyWeather(mode: WeatherMode): void {
    currentWeather = mode;
    applyDayNightAmbient(narrativeRoot.clock.minutes);
    weatherVisualHook(mode);
  }

  // Weather changes need no dedicated command: authored events use setWorldVar
  // on weather.current; Ink uses world_set. This subscription is the live glue.
  narrativeRoot.world.signals.on('changed', ({ key, value }) => {
    if (key !== WEATHER_KEY) return;
    applyWeather(parseWeatherMode(value));
  });

  // Boot: dim/brighten immediately for the starting time of day (default 08:00).
  // Weather defaults to clear (root seed); load re-apply path re-syncs both.
  applyDayNightAmbient(narrativeRoot.clock.minutes);
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

  // Session-scoped weather particles (C8). Built once next to the character;
  // hop teardown must NOT dispose this (map-local bundles only).
  const weatherLayer = createWeatherLayer({ scene });

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

  // Shared remappable binding table (C2 WU-04): one table for all keyboard seams.
  let bindingTable: BindingTable = await loadInputBindingTable();
  let heldDirection = createMostRecentHeldDirection(bindingTable);

  function applyBindingTable(next: BindingTable): void {
    bindingTable = next;
    heldDirection = createMostRecentHeldDirection(bindingTable);
  }

  /**
   * Minimal remap surface (no settings UI): console / CDP can rebind and the
   * change is persisted under `~/.threemaker/input-bindings.json` (or
   * localStorage outside Tauri). Exit criterion C2: remap survives restart.
   */
  window.__threemaker_input = {
    rebindKeyboard(action: string, key: string) {
      applyBindingTable(rebindKeyboard(bindingTable, action, key));
      void saveInputBindingTable(bindingTable);
    },
    list(): readonly ActionBinding[] {
      return bindingTable.list();
    },
    reset() {
      applyBindingTable(createDefaultInputBindingTable());
      void saveInputBindingTable(bindingTable);
    },
  };

  // Gamepad is polled each frame (see game loop); pure edge tracker is DOM-free.
  const gamepadTracker = createGamepadTracker();
  // Walk-input is DOM-free; this host binds key events to press/release.
  window.addEventListener('keydown', (event) => {
    heldDirection.press(event.key);
  });
  window.addEventListener('keyup', (event) => {
    heldDirection.release(event.key);
  });

  // Declared before the CameraRig state below on purpose: applyCameraPose()
  // closes over `hd2d`, so the pipeline must exist before any pose is applied.
  const hd2d = createHd2dPipeline(renderer, scene, camera);

  // Wire the WU-02 visual hook now that both the particle layer and pipeline exist.
  weatherVisualHook = (mode: WeatherMode): void => {
    weatherLayer.setMode(mode);
    if (mode === 'fog') {
      hd2d.setFog(
        DEFAULT_HD2D_KNOBS.fog.color,
        DEFAULT_HD2D_KNOBS.fog.near * FOG_MODE_NEAR_SCALE,
        DEFAULT_HD2D_KNOBS.fog.far * FOG_MODE_FAR_SCALE,
      );
    } else {
      hd2d.setFog(
        DEFAULT_HD2D_KNOBS.fog.color,
        DEFAULT_HD2D_KNOBS.fog.near,
        DEFAULT_HD2D_KNOBS.fog.far,
      );
    }
  };

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
    // Anchor weather volume to the camera (not the follow target) so first-
    // person head placement keeps rain/snow around the lens correctly.
    weatherLayer.followCamera(camera.position);
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
      narrativeSprites: bundle?.sprites.length ?? 0,
      propInstances: propsBundle?.count ?? 0,
      lightInstances: lightsBundle?.count ?? 0,
      litTiles: sessionLitTiles,
      backend: rendererBackend,
      frameTimeMs: frameTimeMsEma,
      hopsCompleted: hopStats.hopsCompleted,
      lastOutgoingNarrativeSprites: hopStats.lastOutgoingNarrativeSprites,
      lastOutgoingFloorTextureKeys: hopStats.lastOutgoingFloorTextureKeys,
      lastOutgoingPropInstances: hopStats.lastOutgoingPropInstances,
      lastOutgoingPropAssets: hopStats.lastOutgoingPropAssets,
      lastOutgoingLights: hopStats.lastOutgoingLights,
      inventory: narrativeRoot.inventory.snapshot(),
      stats: narrativeRoot.stats.snapshot(),
      clockMinutes: narrativeRoot.clock.minutes,
      // Particle visibility on the existing Weather row (e.g. `rain (3000)`).
      weather: weatherLayer.particlesVisible
        ? `${currentWeather} (${weatherLayer.particleCount})`
        : currentWeather,
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
      get narrativeSprites() {
        return bundle?.sprites.length ?? 0;
      },
      get propInstances() {
        return propsBundle?.count ?? 0;
      },
      get lightInstances() {
        return lightsBundle?.count ?? 0;
      },
      get litTiles() {
        return sessionLitTiles;
      },
      get backend() {
        return rendererBackend;
      },
      get frameTimeMs() {
        return frameTimeMsEma;
      },
      get hopsCompleted() {
        return hopStats.hopsCompleted;
      },
      get lastHopOutgoingSprites() {
        return hopStats.lastOutgoingNarrativeSprites;
      },
      get lastHopOutgoingFloorTextures() {
        return hopStats.lastOutgoingFloorTextureKeys;
      },
      get lastHopOutgoingPropInstances() {
        return hopStats.lastOutgoingPropInstances;
      },
      get lastHopOutgoingPropAssets() {
        return hopStats.lastOutgoingPropAssets;
      },
      get lastHopOutgoingLights() {
        return hopStats.lastOutgoingLights;
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
        return bundle?.interpreter.state ?? 'idle';
      },
      get clockMinutes() {
        return narrativeRoot.clock.minutes;
      },
      get weather() {
        return currentWeather;
      },
      get weatherParticlesVisible() {
        return weatherLayer.particlesVisible;
      },
    };
  }

  // Narrative runtime wiring (spec R6, design D1), split by LIFETIME.
  // `narrativeRoot` is SESSION-scoped and created exactly ONCE, deliberately
  // ABOVE the per-map swap logic below: it owns the `WorldState` whose whole
  // purpose is to outlive the map that wrote it, the once-per-session seed set,
  // and the single dialogue overlay. `bundle` is PER-MAP (stories, provider,
  // interpreter, registries, sprites), rebuilt by `buildNarrativeBundle` and
  // freed by `disposeNarrativeBundle`. A `new WorldState()` INSIDE the per-map
  // block is the defect that forced this whole wiring to gate itself off
  // instead of rebuilding; hoisting it is what un-gates it.
  //
  // A map that authors no narrative gets NO bundle at all (spec R5), so reads
  // below are `bundle?.`-guarded rather than flag-gated: nothing is constructed
  // to hide, which is what the deleted `demoMapActive` stood in for.
  // (`bundle` binding is hoisted earlier — next to hopStats — so debug snapshot
  // init never TDZ-crashes; assignment still happens in this narrative block.)
  /**
   * True for the WHOLE duration of a manifest map hop ('g', below) -- every
   * `await` in it included, both the incoming map's load and its narrative
   * bundle build. Declared out HERE, beside the hop path, because the game loop
   * is what has to honour it: the loop keeps ticking across those awaits, and
   * between the synchronous session swap and the bundle's attachment `bundle` is
   * `undefined`. A step taken inside that window would walk through NPCs (the
   * mover's npc hook has no registry to ask) and would lose any `enter` trigger
   * tile it crossed PERMANENTLY -- the incoming `TriggerIndex` is constructed
   * afterwards with `arrival = spawn` and only fires on a tile CHANGE. Freezing
   * the player's own input for the whole hop is what makes that window
   * unobservable instead of partially handled.
   */
  let cyclingManifestMap = false;
  let activeEntityMove: {
    readonly mover: GridMover;
    readonly direction: Direction;
    stepsRemaining: number;
    readonly done: () => void;
  } | null = null;

  /**
   * Filled once the multi-map manifest path installs hop machinery below.
   * `transferMap` queues a request and runs it on a microtask after the
   * interpreter returns to idle (command is terminal; hop uses canBeginMapHop).
   *
   * `arrival: 'authored'` uses the destination map's own spawn after load
   * (G-cycle). A coordinate object is the transferMap path.
   */
  let hopToManifestFile:
    | ((
        mapFile: string,
        arrival:
          | 'authored'
          | {
              readonly x: number;
              readonly y: number;
              readonly facing?: Direction;
              readonly floorIndex?: number;
            },
        opts?: { readonly advanceIndexOnUnplayable?: boolean },
      ) => Promise<void>)
    | null = null;

  /**
   * Active map identity for C3 save (`mapFile` relative to `.threemaker/maps`).
   * Manifest hops update this; single-file authored mode uses `current.tmmap.json`.
   * Empty when the session is a DEV fixture with no authored path.
   */
  let activeMapFile =
    manifestNav?.manifest.maps[manifestNav.startIndex]?.file ??
    (sessionOverride ? 'current.tmmap.json' : '');
  /** Narrative content for the active map — needed to rebuild after same-map load. */
  let activeNarrative = sessionOverride?.narrative;
  /** Props for the active map — rebuilt on hop / same-map load with the narrative. */
  let activeProps: readonly PropDocument[] = sessionOverride?.props ?? [];
  /** Lights for the active map — rebuilt on hop / same-map load with props. */
  let activeLights: readonly LightDocument[] = sessionOverride?.lights ?? [];

  // App-supplied effects for every bundle's interpreter -- session-lived, since
  // it closes over the mutable `session`/`activeEntityMove` rather than over one
  // map's content.
  const host: EventHost = {
    moveEntity(entityId, direction, steps, done) {
      if (entityId !== 'player') {
        // NPCs are static in v1 (see NpcRegistry's documented ceiling) --
        // nothing to drive.
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
    transferMap(mapFile, x, y, facing, done) {
      // End the script first (`done`); hop only after idle. Guarded again
      // inside hopToManifestFile via canBeginMapHop.
      const decision = decideTransferMapHost({
        hopPathActive: hopToManifestFile !== null,
        hopInFlight: cyclingManifestMap,
        activeTraversal: Boolean(activeTraversal),
        mapFile,
        x,
        y,
        ...(facing !== undefined ? { facing: facing as Direction } : {}),
      });
      if (!decision.ok) {
        const detail =
          decision.reason === 'no-hop-path'
            ? 'no multi-map manifest hop path is active'
            : `hop or traversal in flight (${decision.reason})`;
        console.error(
          `transferMap to "${mapFile}" refused: ${detail}; staying on the current map.`,
        );
        done();
        return;
      }
      const hop = hopToManifestFile;
      if (!hop) {
        // decideTransferMapHost already required hopPathActive; defensive.
        done();
        return;
      }
      done();
      queueMicrotask(() => {
        void hop(decision.mapFile, decision.arrival);
      });
    },
  };

  let highlightedIndex = 0;
  let pendingChoiceCount = 0;

  /**
   * Wires one bundle's interpreter to the session overlay. Called on EVERY
   * bundle build, not once per session: the interpreter is per-map (spec R6), so
   * its signal subscriptions are per-map too. The overlay is resolved through
   * `narrativeRoot.overlay()` rather than captured as a local, so every bundle
   * drives the same session chrome.
   *
   * `script:failed` is load-bearing, not diagnostics: it is the ONLY surface
   * through which a story/provider failure ever reaches the player.
   */
  function subscribeDialogueSignals(interpreter: MapNarrativeBundle['interpreter']): void {
    interpreter.signals.on('dialogue:line', (event) => {
      narrativeRoot.overlay().showLine(event.speaker, event.text);
    });
    interpreter.signals.on('dialogue:choices', (event) => {
      highlightedIndex = 0;
      pendingChoiceCount = event.options.length;
      narrativeRoot.overlay().showChoices(event.options, highlightedIndex);
    });
    interpreter.signals.on('dialogue:closed', () => {
      pendingChoiceCount = 0;
    });
    interpreter.signals.on('script:finished', () => {
      pendingChoiceCount = 0;
      narrativeRoot.overlay().hide();
      // See createMostRecentHeldDirection's clear() doc: drops any stale
      // held-arrow entry left over from dialogue navigation so the player
      // doesn't auto-walk the instant control returns to them.
      heldDirection.clear();
    });
    interpreter.signals.on('script:failed', (event) => {
      pendingChoiceCount = 0;
      const message = event.error instanceof Error ? event.error.message : String(event.error);
      console.error('Event script failed:', event.error);
      narrativeRoot.overlay().showError(message);
      heldDirection.clear();
    });
  }

  /**
   * Frees the outgoing map's narrative runtime: its NPC meshes leave the shared
   * scene and the NPC sheet textures the bundle itself loaded are disposed
   * (spec R7 -- before this change those sprites were only ever hidden). The
   * reference is dropped only AFTER `dispose()` has run.
   *
   * It never touches FLOOR textures: those come from `loadAuthoredMap`'s tileset
   * resolution and are freed by the swap's own `disposeFloorTextures`
   * (`buildFloorRender` sets `ownsTextures: false`), so each set has exactly one
   * disposal path and no double free is reachable.
   */
  function disposeNarrativeBundle(): void {
    bundle?.dispose();
    bundle = undefined;
  }

  function disposePropsBundle(): void {
    propsBundle?.dispose();
    propsBundle = undefined;
  }

  function disposeLightsBundle(): void {
    lightsBundle?.dispose();
    lightsBundle = undefined;
  }

  /**
   * Builds the incoming map's narrative runtime over the session root, leaving
   * `bundle` undefined when that map authors none (spec R5). Must run AFTER
   * `createMapSession`: each NPC sprite's ground Y comes from ITS OWN floor in
   * the new session, and the trigger index's already-entered tile is the
   * arrival (default: session spawn + current floor; same-map load overrides
   * with the saved player tile so enter triggers underfoot do not re-fire).
   */
  async function buildNarrativeBundle(
    narrative: AuthoredMapNarrative | undefined,
    arrivalOverride?: { readonly x: number; readonly y: number; readonly floor: number },
  ): Promise<void> {
    const arrival = arrivalOverride ?? {
      ...session.spawn,
      floor: session.floorRouter.currentFloor,
    };
    bundle = await buildMapNarrativeBundle({
      narrative,
      root: narrativeRoot,
      host,
      scene,
      floors: session.floorRouter.floors,
      arrival,
      resolveObjectTexture: resolveObjectTextureReal,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      // Initial routine application: evening boot / night hop land at the
      // current clock minute's stops, not authored base tiles.
      minutes: narrativeRoot.clock.minutes,
    });
    if (bundle) subscribeDialogueSignals(bundle.interpreter);
  }

  /**
   * Builds this map's glTF prop instances (C5). Empty `props` → no bundle.
   * Must run AFTER `createMapSession` so each prop's ground Y samples its floor.
   */
  async function buildPropsBundle(props: readonly PropDocument[]): Promise<void> {
    propsBundle = await buildMapProps({
      props,
      scene,
      floors: session.floorRouter.floors,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      resolveObjectBinary: resolveObjectBinaryReal,
    });
  }

  /** Move attached NPC lanterns for every NPC that actually teleported. */
  function followNpcLights(moved: readonly RoutineMove[]): void {
    if (!lightsBundle || moved.length === 0) return;
    for (const m of moved) {
      lightsBundle.updateNpc(
        m.npcId,
        new THREE.Vector3(
          tileCenterToWorld(m.position.x, TILE_WORLD_SIZE),
          m.position.groundY,
          tileCenterToWorld(m.position.y, TILE_WORLD_SIZE),
        ),
      );
    }
  }

  /**
   * Re-apply absolute routine positions for the live clock minute and move
   * attached lanterns. Used after save load (interpreter is idle under the
   * existing load gates — no dialogue-gate needed). Idempotent when the
   * bundle already applied the same minute at build.
   */
  function applyRoutinesForClock(): void {
    if (!bundle) return;
    followNpcLights(bundle.applyRoutines(narrativeRoot.clock.minutes));
  }

  /**
   * NPC anchors for attached lights: tile coords + ground Y from each NPC's
   * own floor. Resolves day-routine stops against the live clock so evening
   * boots / hops place lanterns on the stop the sprite already occupies
   * (bundle build applies the same minute).
   */
  function buildNpcLightPositions(
    narrative: AuthoredMapNarrative | undefined,
  ): ReadonlyMap<string, { x: number; y: number; floor: number; groundY: number }> {
    const positions = new Map<string, { x: number; y: number; floor: number; groundY: number }>();
    if (!narrative) return positions;
    const minutes = narrativeRoot.clock.minutes;
    for (const npc of narrative.npcs) {
      const floor = session.floorRouter.floors[npc.floor];
      if (!floor) continue;
      let x = npc.x;
      let y = npc.y;
      if (npc.routine !== undefined && npc.routine.length > 0) {
        const stop = routinePositionAt(
          { at: 0, x: npc.x, y: npc.y, facing: npc.facing },
          npc.routine,
          minutes,
        );
        x = stop.x;
        y = stop.y;
      }
      positions.set(npc.id, {
        x,
        y,
        floor: npc.floor,
        groundY: groundYAt(floor.elevation, x, y, HEIGHT_UNIT, floor.baseElevation),
      });
    }
    return positions;
  }

  /**
   * Builds this map's authored lights (C6). Empty `lights` → no bundle.
   * Must run AFTER `createMapSession` (and ideally after narrative, so NPC
   * attach anchors resolve). Budget exceed → loud throw (never silent drop).
   */
  function buildLightsBundle(
    lights: readonly LightDocument[],
    narrative: AuthoredMapNarrative | undefined,
  ): void {
    lightsBundle = buildMapLights({
      lights,
      scene,
      floors: session.floorRouter.floors,
      tileWorldSize: TILE_WORLD_SIZE,
      heightUnit: HEIGHT_UNIT,
      npcPositions: buildNpcLightPositions(narrative),
      budget: LIGHT_BUDGET,
    });
  }

  /** Apply a resolved gameplay intent (keyboard or gamepad share this path). */
  function applyGameplayKeyAction(action: GameplayKeyAction): void {
    if (!bundle) return;
    const { interpreter } = bundle;
    switch (action.kind) {
      case 'try-interact': {
        const { x, y } = session.mover.tile;
        const facing = session.mover.facing;
        const floor = session.floorRouter.currentFloor;
        const npc = bundle.npcRegistry.npcAdjacentFacing(floor, x, y, facing);
        if (npc) {
          interpreter.run(bundle.events[npc.onInteract] ?? []);
          return;
        }
        for (const eventId of bundle.triggerIndex.interact(floor, x, y, facing)) {
          interpreter.run(bundle.events[eventId] ?? []);
        }
        return;
      }
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
        highlightedIndex = nextHighlightedIndex(highlightedIndex, action.delta, pendingChoiceCount);
        narrativeRoot.overlay().setHighlightedIndex(highlightedIndex);
        return;
    }
  }

  // Narrative keys (C2: pure resolveGameplayKeyAction; host applies).
  window.addEventListener('keydown', (event) => {
    if (event.repeat || !bundle) return;
    const action = resolveGameplayKeyAction(event.key, bundle.interpreter.state, bindingTable);
    if (action) applyGameplayKeyAction(action);
  });

  /**
   * Pointer → same ActionId path as keyboard/gamepad (C2 WU-03).
   * Canvas primary = interact; dialogue choice rows = chooseIndex; dialogue
   * body = interact (advance/confirm via resolveGameplayAction).
   */
  function applyPointerSample(sample: PointerSample): void {
    const intent = resolvePointerIntent(sample);
    if (!intent) return;
    if (intent.kind === 'chooseIndex') {
      applyGameplayKeyAction({ kind: 'chooseIndex', index: intent.index });
      return;
    }
    if (!bundle) return;
    const action = resolveGameplayAction(intent.edge.action, bundle.interpreter.state);
    if (action) applyGameplayKeyAction(action);
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    applyPointerSample({
      phase: 'down',
      button: event.button,
      target: { kind: 'actionable' },
    });
  });

  narrativeRoot.overlay().element.addEventListener('pointerdown', (event) => {
    const attr =
      event.target instanceof Element
        ? (event.target.closest('[data-choice-index]')?.getAttribute('data-choice-index') ??
          undefined)
        : undefined;
    applyPointerSample({
      phase: 'down',
      button: event.button,
      target: pointerTargetFromDialogueHit(attr),
    });
  });

  // The booted map's own bundle. Every later one comes from a swap sequence
  // below. Not wrapped in a try/catch: `loadAuthoredMap` already proved every
  // authored reference resolves, so a throw here means a floor reference this
  // session cannot satisfy (or a sidecar that only fails at `compileInk`) -- a
  // real content bug that must reach `main()`'s handler, not a swallowed console
  // line.
  //
  // ponytail: this throw escapes AFTER the renderer, the session, the floor
  // textures and the window key listeners of this attempt already exist, and
  // `main()`'s handlers only recover the DOM (`showStatus` replaces the
  // container's children) -- none of that is disposed, so the fallback attempt
  // boots a SECOND instance on top and one bad authored map costs one leaked
  // GPU context per boot attempt. Declared ceiling, not an oversight: closing it
  // needs a disposal path for a HALF-initialized app (a teardown handle
  // accumulated as each of renderer/session/textures/listeners is created, run
  // by one `catch` around the whole of `renderFixtureMap`), which is a
  // structural change to this function's setup, not a local fix.
  await buildNarrativeBundle(sessionOverride?.narrative);
  await buildPropsBundle(sessionOverride?.props ?? []);
  buildLightsBundle(sessionOverride?.lights ?? [], sessionOverride?.narrative);

  // View/debug keys (C2 prep: pure resolveViewKeyAction; host applies effects).
  // Real engine features (camera, zoom, noclip) — available in production;
  // unlike the 'g' dev map-cycle below.
  // Any key that maps to a game action is consumed (preventDefault) so browser
  // accelerators — notably F5 reload for system.save — do not race the game.
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const action = resolveViewKeyAction(event.key, 'down', bindingTable);
    if (!action) return;
    event.preventDefault();
    switch (action.kind) {
      case 'toggle-post-processing':
        postProcessingEnabled = !postProcessingEnabled;
        hd2d.setEnabled(postProcessingEnabled);
        return;
      case 'cycle-camera-mode':
        cameraMode = cycleCameraMode(cameraMode);
        updateCameraModeIndicator();
        return;
      case 'tilt':
        cameraTiltDeg = clampTiltDeg(cameraTiltDeg + action.delta * CAMERA_TILT_STEP_DEG);
        return;
      case 'zoom':
        cameraDistance = clampRange(
          cameraDistance + action.delta * CAMERA_ZOOM_STEP,
          CAMERA_MIN_DISTANCE,
          CAMERA_MAX_DISTANCE,
        );
        return;
      case 'noclip-on':
        // Held, not toggled — keyup applies noclip-off.
        noclipActive = true;
        debugPanel.setNoclipActive(true);
        return;
      case 'save':
        void saveGameProgress();
        return;
      case 'load':
        void loadGameProgress();
        return;
      default:
        return;
    }
  });

  // Releasing Ctrl restores normal passability immediately (`withNoclip`) —
  // including the "don't re-trap" escape hatch if noclip carried the player
  // into/through a wall.
  window.addEventListener('keyup', (event) => {
    const action = resolveViewKeyAction(event.key, 'up', bindingTable);
    if (!action) return;
    event.preventDefault();
    if (action.kind !== 'noclip-off') return;
    noclipActive = false;
    debugPanel.setNoclipActive(false);
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

    /**
     * This cycle's point of no return, shared by every branch: the outgoing map's
     * narrative runtime is freed BEFORE its session is, mirroring the manifest
     * hop's order (design D1 -- one disposal path, outgoing bundle first).
     *
     * Called from inside each branch, AFTER whatever that branch can still fail
     * at (only 'mz' can: its `await loadMzFixtureMapData()`), so a branch that
     * never reaches this line leaves the still-displayed map's NPCs untouched.
     * It must not sit after the branch either: `createMapSession` runs after
     * `session.dispose()` and can throw (an unstandable spawn), and the outer
     * catch only rolls `mode` back -- which would leave the outgoing map's NPC
     * sprites in the scene over a disposed session, with nothing left to rebuild
     * them from. None of this cycle's targets is an authored document, so no new
     * bundle is built either way (spec R5): the swap REMOVES the previous map's
     * billboards rather than merely hiding them (the deleted `demoMapActive`, and
     * the R7 leak it left behind).
     *
     * Declared ceiling, unchanged: cycling back to 'fixture' rebuilds only the
     * booted map's floor 0, so narrative is not restored with it -- dev-toggle
     * only, and a restart brings it back.
     */
    function disposeOutgoingMap(): void {
      disposeNarrativeBundle();
      disposePropsBundle();
      disposeLightsBundle();
      session.dispose();
      // DEV cycle targets never author lights — restore unlit base before rebuild.
      applyBaseSceneLights(false);
      applyDayNightAmbient(narrativeRoot.clock.minutes);
      activeLights = [];
    }

    window.addEventListener('keydown', (event) => {
      if (event.repeat || !isMapCycleKey(event.key) || cycling) return;
      // Block map switching while a script is running/blocked: disposing
      // `session` mid-script would strand an in-flight moveEntity (its
      // `mover` reference goes stale, so the host's `done()` never fires
      // and the interpreter never returns to idle) and the dialogue overlay
      // would keep showing over a session it no longer belongs to. Refusing
      // the cycle here -- rather than attempting to cancel the running
      // script -- is consistent with how the player's own movement is already
      // paused during a script.
      if (bundle && bundle.interpreter.state !== 'idle') return;
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
            disposeOutgoingMap();
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
            disposeOutgoingMap();
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
            disposeOutgoingMap();
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
            disposeOutgoingMap();
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

  // Manifest multi-map hop path (rpgm-whole-game-import + C1b transferMap).
  // Production-safe. Mutually exclusive with the DEV fixture-cycle above
  // (`manifestNav` is only ever passed when this branch should own hops).
  // Installed for any multi-map manifest so G-cycle and transferMap share one
  // dispose/rebuild sequence (design D1 — no second disposal path).
  if (manifestNav && manifestNav.manifest.maps.length > 1) {
    let currentMapIndex = manifestNav.startIndex;
    /**
     * True while the overlay is showing a hop's narrative-build failure (below).
     * Tracked because nothing else would ever take that banner down: a failed
     * build leaves NO bundle, so no `script:finished` signal can hide the
     * overlay, and it would otherwise still be sitting over whichever map the
     * next successful hop brings in.
     */
    let narrativeFailureShown = false;
    // The `textures` record every floor of the CURRENTLY-rendered manifest
    // map shares (same object reference across floors -- see
    // `disposeFloorTextures`'s doc comment). `loadAuthoredMap` allocates a
    // brand new set per hop with no cross-hop cache, and `ownsTextures: false`
    // above means nothing else ever frees them -- tracked here so a
    // completed hop can dispose the map it is leaving, right after
    // `session.dispose()`. Seeded from the initial map this session was
    // already built with (`sessionOverride`, the authored/manifest path's
    // own first `loadAuthoredMap` result), so even the very first hop
    // frees it correctly.
    let currentTextures = sessionOverride?.floorSources[0]?.textures;
    /** Full floor sources for lightmap dispose (per-floor textures, not shared). */
    let currentFloorSources = sessionOverride?.floorSources;

    hopToManifestFile = async (mapFile, arrival, opts) => {
      const maps = manifestNav.manifest.maps;
      const plan = planManifestHop({
        guard: {
          hopInFlight: cyclingManifestMap,
          interpreterState: bundle?.interpreter.state ?? 'idle',
          activeTraversal: Boolean(activeTraversal),
        },
        maps,
        mapFile,
      });
      if (!plan.ok) {
        const detail =
          plan.reason === 'ambiguous-basename'
            ? `matches multiple manifest maps by basename — use the full manifest path`
            : plan.reason === 'not-in-manifest'
              ? `is not in the game manifest`
              : `refused (${plan.reason})`;
        console.error(
          `transferMap / hop target "${mapFile}" ${detail}; staying on the current map.`,
        );
        return;
      }
      const targetIndex = plan.index;
      const targetFile = plan.file;

      cyclingManifestMap = true;
      try {
        const nextResult = await manifestNav.loadEntry(targetFile);
        if (!nextResult) {
          console.error(
            `Failed to load manifest map "${targetFile}" -- staying on the current map.`,
          );
          return;
        }

        // Same pre-flight as the boot scan: unplayable entries must never
        // reach session.dispose() (would leave an unrecoverable half-swap).
        if (!isAuthoredResultPlayable(nextResult)) {
          console.error(
            `Manifest map "${targetFile}" has no standable spawn tile; hop cancelled, staying on the current map.`,
          );
          // G-cycle advances past unplayable entries so the next press does
          // not retry forever; transferMap does not.
          if (opts?.advanceIndexOnUnplayable) {
            currentMapIndex = targetIndex;
          }
          disposeFloorTextures(nextResult.floorSources[0]?.textures, nextResult.floorSources);
          return;
        }

        currentMapIndex = targetIndex;
        activeMapFile = targetFile;
        activeNarrative = nextResult.narrative;
        activeProps = nextResult.props;
        activeLights = nextResult.lights;
        // Point of no return. Order: dispose outgoing narrative/props/lights →
        // session → floor textures (+ lightmaps) → create session → build bundles.
        const outgoingNarrativeSprites = bundle?.sprites.length ?? 0;
        const outgoingFloorTextureKeys = currentTextures ? Object.keys(currentTextures).length : 0;
        const outgoingPropInstances = propsBundle?.count ?? 0;
        const outgoingPropAssets = propsBundle?.assetCount ?? 0;
        const outgoingLights = lightsBundle?.count ?? 0;
        disposeNarrativeBundle();
        disposePropsBundle();
        disposeLightsBundle();
        session.dispose();
        disposeFloorTextures(currentTextures, currentFloorSources);
        hopStats = recordHopCompleted(hopStats, {
          outgoingNarrativeSprites,
          outgoingFloorTextureKeys,
          outgoingPropInstances,
          outgoingPropAssets,
          outgoingLights,
        });
        currentTextures = nextResult.floorSources[0]?.textures;
        currentFloorSources = nextResult.floorSources;

        // Pure arrival resolve (G-cycle authored spawn vs transferMap coords).
        const hopArrival = resolveHopArrival(arrival, nextResult.spawn);
        const sessionOpts: { readonly spawn: FloorSpawn } | undefined = hopArrival
          ? { spawn: hopArrival.spawn }
          : undefined;

        // Apply lit/ambient before createMapSession so buildFloorRender sees it.
        // Day-night after base so a map entered at night is dark immediately.
        applyBaseSceneLights(mapHasAuthoredLights(nextResult.lights));
        applyDayNightAmbient(narrativeRoot.clock.minutes);
        session = createMapSession(nextResult.floorSources, nextResult.stairLinks, sessionOpts);
        // transferMap may set facing; FloorSpawn has no facing field, so apply
        // it on the mover after the session exists (same-map teleport pattern).
        if (hopArrival?.facing !== undefined) {
          session.mover.teleport(hopArrival.spawn.x, hopArrival.spawn.y, hopArrival.facing);
        }
        try {
          await buildNarrativeBundle(nextResult.narrative);
          if (narrativeFailureShown) {
            narrativeRoot.overlay().hide();
            narrativeFailureShown = false;
          }
        } catch (error) {
          // Past the point of no return: map is playable but narrative-free.
          console.error(
            `Manifest map "${targetFile}" loaded, but its authored narrative did not:`,
            error,
          );
          narrativeRoot
            .overlay()
            .showError(
              `${targetFile}: ${describeAuthoredFailure(error)} -- this map is playable, but WITHOUT its authored NPCs, triggers and events.`,
            );
          narrativeFailureShown = true;
        }
        try {
          await buildPropsBundle(nextResult.props);
        } catch (error) {
          // Past the point of no return: map stays playable without props.
          console.error(
            `Manifest map "${targetFile}" loaded, but its authored props did not:`,
            error,
          );
        }
        try {
          buildLightsBundle(nextResult.lights, nextResult.narrative);
        } catch (error) {
          // Past the point of no return: map stays playable without lights.
          console.error(
            `Manifest map "${targetFile}" loaded, but its authored lights did not:`,
            error,
          );
        }
        focusCameraOnSpawn();
      } catch (error) {
        console.error(`Failed to hop to manifest map "${mapFile}":`, error);
      } finally {
        cyclingManifestMap = false;
      }
    };

    window.addEventListener('keydown', (event) => {
      if (event.repeat || !isMapCycleKey(event.key)) return;
      const cycle = planNextManifestCycle(manifestNav.manifest.maps, currentMapIndex);
      if (!cycle) return;
      // Single load path: hopToManifestFile owns guards + dispose/rebuild.
      void hopToManifestFile?.(cycle.file, 'authored', {
        advanceIndexOnUnplayable: true,
      });
    });
  }

  /**
   * C3 WU-02: capture/persist/apply game save. Surface is `window.__threemaker_save`
   * only (keyboard binding is WU-03). Load fails cleanly before mutating state
   * when mapFile/floor/position cannot be realized.
   *
   * World rehydrate runs BEFORE hop/bundle rebuild so `seedIfAbsent` cannot
   * clobber saved keys (seeds only fill absent keys).
   */
  function gameSaveMapCatalog(): readonly string[] {
    if (manifestNav) return manifestNav.manifest.maps.map((entry) => entry.file);
    return activeMapFile.length > 0 ? [activeMapFile] : [];
  }

  async function saveGameProgress(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const gate = canSaveGameProgress({
      hopInFlight: cyclingManifestMap,
      activeTraversal: Boolean(activeTraversal),
    });
    if (!gate.ok) {
      const message =
        gate.reason === 'hop-in-flight'
          ? i18n.t('save.blockedHop')
          : i18n.t('save.blockedTraversal');
      narrativeRoot.overlay().showError(message);
      return { ok: false, reason: gate.reason };
    }
    if (activeMapFile.length === 0) {
      narrativeRoot.overlay().showError(i18n.t('save.noMap'));
      return { ok: false, reason: 'no authored map identity to save' };
    }
    const snapshot = captureGameSaveSnapshot({
      mapFile: activeMapFile,
      x: session.mover.tile.x,
      y: session.mover.tile.y,
      floor: session.floorRouter.currentFloor,
      facing: session.mover.facing,
      world: narrativeRoot.world.snapshot(),
      inventory: narrativeRoot.inventory.snapshot(),
      stats: narrativeRoot.stats.snapshot(),
      stories: bundle?.stories ?? new Map(),
    });
    if (!snapshot) {
      narrativeRoot.overlay().showError(i18n.t('save.failed'));
      return { ok: false, reason: 'could not capture runtime snapshot' };
    }
    await persistGameSaveSnapshot(snapshot);
    narrativeRoot.overlay().showLine(i18n.t('save.systemSpeaker'), i18n.t('save.saved'));
    return { ok: true };
  }

  async function loadGameProgress(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const gate = canLoadGameProgress({
      hopInFlight: cyclingManifestMap,
      interpreterState: bundle?.interpreter.state ?? 'idle',
      activeTraversal: Boolean(activeTraversal),
    });
    if (!gate.ok) {
      const message =
        gate.reason === 'hop-in-flight'
          ? i18n.t('save.blockedHop')
          : gate.reason === 'traversal-active'
            ? i18n.t('save.blockedTraversal')
            : i18n.t('save.blockedBusy');
      narrativeRoot.overlay().showError(message);
      return { ok: false, reason: gate.reason };
    }
    const loaded = await loadGameSaveSnapshot();
    if (!loaded.ok) {
      narrativeRoot.overlay().showError(`${i18n.t('save.loadFailed')}: ${loaded.reason}`);
      return { ok: false, reason: loaded.reason };
    }
    const snap = loaded.snapshot;

    const catalog = resolveMapFileInCatalog(snap.mapFile, { files: gameSaveMapCatalog() });
    if (!catalog.ok) {
      narrativeRoot.overlay().showError(catalog.message);
      return { ok: false, reason: catalog.reason };
    }

    // Same-map path: validate against the live session without disposing first.
    if (catalog.mapFile === activeMapFile || !hopToManifestFile) {
      if (catalog.mapFile !== activeMapFile) {
        const message = `Save mapFile ${JSON.stringify(catalog.mapFile)} cannot be loaded in this session.`;
        narrativeRoot.overlay().showError(message);
        return { ok: false, reason: 'map-unresolved' };
      }
      const placement = validateSavePlacement(snap, {
        floorCount: session.floorRouter.floors.length,
        width: session.map.width,
        height: session.map.height,
      });
      if (!placement.ok) {
        narrativeRoot.overlay().showError(placement.message);
        return { ok: false, reason: placement.reason };
      }
      // Commit only after validation — session stores first (pre-validated so
      // inventory/stats never half-mutate), then mover/bundle. World rehydrate
      // before hop/bundle so seedIfAbsent cannot clobber saved keys.
      const stores = applyGameSaveSessionStores(snap, {
        world: narrativeRoot.world,
        inventory: narrativeRoot.inventory,
        stats: narrativeRoot.stats,
      });
      if (!stores.ok) {
        narrativeRoot.overlay().showError(stores.message);
        return { ok: false, reason: stores.reason };
      }
      // replaceAll (load) emits no world signal — explicit clock re-sync is the
      // documented consequence. Invalid/absent clock.minutes (old saves) leaves
      // the live clock as-is; always re-apply ambient for the current minute.
      resyncClockFromWorldValue(narrativeRoot.clock, narrativeRoot.world.get(CLOCK_MINUTES_KEY));
      // Same for weather: replaceAll emits nothing, so re-apply from world.
      applyWeather(parseWeatherMode(narrativeRoot.world.get(WEATHER_KEY)));
      session.floorRouter.currentFloor = snap.floor;
      session.mover.teleport(snap.x, snap.y, snap.facing);
      session.applyFloorWindow(snap.x, snap.y);
      disposeNarrativeBundle();
      disposePropsBundle();
      disposeLightsBundle();
      // Arrival = save tile (not boot session.spawn) so underfoot enter triggers
      // stay deduped until the player leaves and re-enters.
      await buildNarrativeBundle(activeNarrative, sameMapLoadNarrativeArrival(snap));
      applyGameSaveStoryStates(bundle?.stories ?? new Map(), snap.stories);
      await buildPropsBundle(activeProps);
      buildLightsBundle(activeLights, activeNarrative);
      // Interpreter is idle during load (existing gates). Bundle build already
      // applied current minutes; this re-apply is idempotent and keeps the
      // save path explicit for NPC poses after clock re-sync.
      applyRoutinesForClock();
      focusCameraOnSpawn();
      narrativeRoot.overlay().hide();
      return { ok: true };
    }

    // Multi-map: preload for geometry checks without disposing the live session.
    const preloaded = manifestNav ? await manifestNav.loadEntry(catalog.mapFile) : null;
    if (!preloaded) {
      const message = `Save mapFile ${JSON.stringify(catalog.mapFile)} could not be read.`;
      narrativeRoot.overlay().showError(message);
      return { ok: false, reason: 'map-unresolved' };
    }
    const primary = preloaded.floorSources[0];
    if (!primary) {
      disposeFloorTextures(preloaded.floorSources[0]?.textures, preloaded.floorSources);
      narrativeRoot.overlay().showError('Save target map has no floors.');
      return { ok: false, reason: 'map-unresolved' };
    }
    const placement = validateSavePlacement(snap, {
      floorCount: preloaded.floorSources.length,
      width: primary.map.width,
      height: primary.map.height,
    });
    if (!placement.ok) {
      disposeFloorTextures(primary.textures, preloaded.floorSources);
      narrativeRoot.overlay().showError(placement.message);
      return { ok: false, reason: placement.reason };
    }
    // Free preload textures — hop loads a fresh copy after the point of no return.
    disposeFloorTextures(primary.textures, preloaded.floorSources);

    // Same store apply as same-map: pre-validate inventory/stats before hop.
    const stores = applyGameSaveSessionStores(snap, {
      world: narrativeRoot.world,
      inventory: narrativeRoot.inventory,
      stats: narrativeRoot.stats,
    });
    if (!stores.ok) {
      narrativeRoot.overlay().showError(stores.message);
      return { ok: false, reason: stores.reason };
    }
    // replaceAll (load) emits no world signal — explicit clock re-sync is the
    // documented consequence. Hop re-applies base lights + day-night after load.
    resyncClockFromWorldValue(narrativeRoot.clock, narrativeRoot.world.get(CLOCK_MINUTES_KEY));
    // Same for weather: replaceAll emits nothing, so re-apply from world.
    applyWeather(parseWeatherMode(narrativeRoot.world.get(WEATHER_KEY)));
    await hopToManifestFile(catalog.mapFile, {
      x: snap.x,
      y: snap.y,
      facing: snap.facing,
      floorIndex: snap.floor,
    });
    // Stories live in the rebuilt per-map bundle; restore only if the hop
    // actually landed on the saved map (a refused hop leaves the old bundle).
    if (activeMapFile === catalog.mapFile) {
      applyGameSaveStoryStates(bundle?.stories ?? new Map(), snap.stories);
    }
    // Post-hop: interpreter idle; re-apply restored minutes (idempotent with
    // build-time application that already used the re-synced clock).
    applyRoutinesForClock();
    narrativeRoot.overlay().hide();
    return { ok: true };
  }

  window.__threemaker_save = {
    save: () => saveGameProgress(),
    load: () => loadGameProgress(),
  };

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
    // Player-attached torch / lantern follows the character mesh (torch offset applied inside the bundle).
    lightsBundle?.updatePlayer(character.mesh.position);
  }

  const gameLoop = new GameLoop({
    onTick(dt) {
      const { mover } = session;

      // Prop animation mixers tick BEFORE the traversal early-return so clips
      // keep playing during stair climbs (mixer updates placed after that
      // return would freeze for the whole traversal).
      propsBundle?.update(dt);

      // Session clock: advance every frame; world write only on crossed minutes
      // (one final value even if several minutes cross in one tick).
      const crossedMinutes = tickSessionClock(narrativeRoot.clock, narrativeRoot.world, dt);
      if (crossedMinutes > 0) {
        applyDayNightAmbient(narrativeRoot.clock.minutes);
        // Dialogue gate: skip routine teleports while dialogue/cutscene runs.
        // routinePositionAt is absolute (not incremental) — the next idle
        // crossed minute self-heals to the correct stop without replaying gaps.
        if (bundle) {
          followNpcLights(applyRoutinesIfIdle(bundle, narrativeRoot.clock.minutes));
        }
      }

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

      const interpreterIdle = !bundle || bundle.interpreter.state === 'idle';

      // Gamepad poll (C2 WU-02): same ActionIds as keyboard; edges drive
      // interact/dialogue/noclip, held move merges with keyboard (keyboard wins).
      const gamepad = gamepadTracker.sample(snapshotFromGamepads(navigator.getGamepads()));
      for (const edge of gamepad.edges) {
        if (edge.action === Actions.ViewNoclip) {
          noclipActive = edge.edge === 'pressed';
          debugPanel.setNoclipActive(noclipActive);
          continue;
        }
        if (edge.edge !== 'pressed' || !bundle) continue;
        const intent = resolveGameplayAction(edge.action, bundle.interpreter.state);
        if (intent) applyGameplayKeyAction(intent);
      }

      // Input pause (design's data-flow contract): the player's own
      // requestMove is skipped whenever the interpreter isn't idle, so
      // walking is frozen during dialogue/scripts. A moveEntity command in
      // flight still drives the mover -- that's the interpreter itself
      // commanding the move, not the held keyboard direction.
      // `cyclingManifestMap` extends that same pause across a manifest map hop,
      // awaits included (see the flag's own declaration): the swap replaces
      // `session` and rebuilds `bundle` asynchronously, and a step taken inside
      // that window has no NPC collision and loses the `enter` triggers of every
      // tile it crosses for good. An interpreter-commanded move cannot be in
      // flight there -- the hop refuses to start unless the interpreter is idle.
      if (interpreterIdle && !cyclingManifestMap) {
        const gamepadMove = gamepad.active.find(isMoveAction);
        const direction = heldDirection.current() ?? directionFromMoveAction(gamepadMove);
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

      if (bundle) {
        for (const eventId of bundle.triggerIndex.enter(
          session.floorRouter.currentFloor,
          mover.tile.x,
          mover.tile.y,
        )) {
          bundle.interpreter.run(bundle.events[eventId] ?? []);
        }

        for (const sprite of bundle.sprites) sprite.faceCamera(camera);
      }

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
    const now = performance.now();
    frameTimeMsEma = smoothFrameTimeMs(frameTimeMsEma, now, lastFrameStampMs);
    lastFrameStampMs = now;
    stats.begin();
    gameLoop.tick();
    hd2d.render();
    stats.end();
    stats.update();
  });
}

/**
 * The user-facing text of an authored-map failure. `loadAuthoredMap`'s own
 * narrative rejections are written to be read by the person who authored the
 * map -- they name the map file, the event key, the story id and the expected
 * sidecar path -- so the message is shown verbatim rather than replaced by a
 * localized generic one.
 */
function describeAuthoredFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const containerOrNull = document.getElementById('app');
  if (!containerOrNull) throw new Error('Missing #app container element.');
  // Re-bound to a non-null-typed const: TS's control-flow narrowing above
  // does not carry into the `showStatus` function declaration below (a
  // hoisted declaration, not evaluated in place), so every use from here on
  // reads this binding instead of the still-nullable-typed `containerOrNull`.
  const container: HTMLElement = containerOrNull;

  document.title = i18n.t('app.title');
  document.body.appendChild(buildLocaleSelector());

  const statusEl = document.createElement('div');
  statusEl.className = 'status-message';

  /**
   * Shows `message` and resets `container` to hold ONLY `statusEl` --
   * discarding any renderer canvas a previously-FAILED attempt already
   * appended (boot-resilience fix, adversarial review: a failed
   * `renderFixtureMap` call can throw AFTER `container.appendChild
   * (renderer.domElement)` but before `renderer.setAnimationLoop(...)`,
   * leaving a live, full-viewport, permanently-black canvas behind --
   * `#app`'s CSS sizes every child to fill the whole window, and normal
   * block flow stacks a later child BELOW that dead canvas, off-screen. Two
   * dead canvases from two failed attempts, both still in the DOM, would
   * make even a THIRD, fully-successful render invisible. Calling this
   * before every attempt guarantees the user always sees either a status
   * message or the one live canvas, never a stray dead one covering it).
   */
  function showStatus(message: string): void {
    statusEl.textContent = message;
    container.replaceChildren(statusEl);
  }

  showStatus(i18n.t('map.loading'));

  /**
   * Message of the last authored-map failure, or `undefined` when no authored
   * map was ever found. The two are NOT the same thing and must not print the
   * same status: "no authored map found" for a map that loaded and then failed
   * its narrative cross-validation hides the only diagnostic that names the
   * offending event, story and expected sidecar path.
   */
  let authoredFailure: string | undefined;

  // Authored-load path (loop-crear-jugar, Slice 4a/4b + C9 WU-01 web):
  // Tauri host (`tauri dev` / installed binary) OR a static web payload at
  // `game/manifest.json` (export-web-game). NOT gated on `import.meta.env.DEV`
  // -- an authored map renders the same way in either. `loadAuthoredMap`
  // returns `null` (after logging why) for "no file saved yet"/parse
  // failure/read failure, all of which fall through to the DEV demos/fixture
  // path below, unchanged (spec: "DEV demos remain fallback"). A plain
  // `vite build` without a game payload still ends at `map.noAuthoredMap`.
  let canLoadAuthored = isTauriAvailable();
  if (!canLoadAuthored) {
    try {
      const webManifest = await webReadTextFile('manifest.json');
      if (webManifest !== null) {
        activeGameSource = 'web';
        canLoadAuthored = true;
      }
    } catch (error) {
      console.error('main: web game source probe failed; treating as no authored map.', error);
    }
  } else {
    activeGameSource = 'tauri';
  }

  if (canLoadAuthored) {
    // Multi-map (manifest-driven) authored path (rpgm-whole-game-import):
    // takes priority over the single-file authored path below when
    // `convert-rpgm-game`'s manifest exists and lists at least one map.
    // Falls through to the single-file path unchanged when every manifest
    // map fails (no manifest saved yet, a malformed manifest, or every
    // entry failing to load/render) -- exactly the same fail-soft layering
    // the single-file path already has relative to the DEV fixture below.
    let manifest: GameManifest | undefined;
    try {
      const manifestText = await readActiveManifestText();
      if (manifestText !== null) manifest = parseGameManifest(JSON.parse(manifestText));
    } catch (error) {
      console.error(
        'main: the map manifest failed to parse/validate; falling back to the single authored map.',
        error,
      );
    }

    // Session item/stat stores (C4). Always created; StatBlock rebuilt from
    // game-defs when the manifest names a defs file. Empty when no defs.
    let gameDefsCatalog: GameDefsCatalog = EMPTY_GAME_DEFS_CATALOG;
    const sessionInventory = new Inventory();
    let sessionStats = new StatBlock([]);

    if (manifest?.gameDefs) {
      try {
        const defsPath = `${MAP_DIR_RELATIVE}/${manifest.gameDefs}`;
        const defsText = await readActiveMapText(defsPath);
        if (defsText === null) {
          throw new Error(
            `main: game defs file ${JSON.stringify(manifest.gameDefs)} is missing (looked up at ${JSON.stringify(defsPath)}).`,
          );
        }
        const defs = parseGameDefsJson(defsText);
        gameDefsCatalog = {
          itemIds: new Set(defs.items.map((item) => item.id)),
          statIds: new Set(defs.stats.map((stat) => stat.id)),
        };
        sessionStats = new StatBlock(defs.stats);
      } catch (error) {
        // Same loud surface as a bad map path: log and abandon multi-map so we
        // never silently boot with empty defs when a path was declared.
        console.error(
          'main: the game defs file failed to load/validate; falling back to the single authored map.',
          error,
        );
        authoredFailure = describeAuthoredFailure(error);
        manifest = undefined;
      }
    }

    const sessionStores: SessionNarrativeStores = {
      inventory: sessionInventory,
      stats: sessionStats,
    };

    // loadEntry closes over the session catalog so hops re-validate the same way.
    const loadEntry = (relativeFile: string) => loadAuthoredMapAt(relativeFile, gameDefsCatalog);

    if (manifest) {
      // Try every manifest map, in order, until one actually renders --
      // NOT just `maps[0]`. A real RPG Maker project's very first map
      // (lowest mapId, first MapInfos.json tree entry) is very often an
      // unused/placeholder map with no standable tile anywhere at all
      // (`isAuthoredResultPlayable`'s own doc comment); blindly trying only
      // that one and giving up on the whole batch-converted game over it
      // would be a much worse fallback than simply skipping to the next map.
      for (let index = 0; index < manifest.maps.length; index++) {
        const entry = manifest.maps[index];
        if (!entry) continue;
        try {
          const authored = await loadEntry(entry.file);
          if (!authored) {
            throw new Error(`loadAuthoredMap returned null for manifest entry "${entry.file}".`);
          }
          const primaryFloor = authored.floorSources[0];
          if (!primaryFloor) throw new Error('loadAuthoredMap returned no floors.');
          if (!isAuthoredResultPlayable(authored)) {
            throw new Error(`manifest map "${entry.file}" has no standable spawn tile.`);
          }

          const { texture: characterTexture, characterIndex } = await resolvePlayerCharacterTexture(
            manifest.actorSheet,
          );
          showStatus(i18n.t('map.loading'));
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
              narrative: authored.narrative,
              props: authored.props,
              lights: authored.lights,
            },
            { manifest, loadEntry, startIndex: index },
            sessionStores,
          );
          return;
        } catch (error) {
          console.error(
            `main: manifest map "${entry.file}" failed to load/render; trying the next map.`,
            error,
          );
          authoredFailure = describeAuthoredFailure(error);
          showStatus(i18n.t('map.loading'));
        }
      }
      console.error(
        'main: every manifest map failed to load/render; falling back to the single authored map.',
      );
    }

    try {
      const authored = await loadAuthoredMap({
        mapRelativePath: MAP_FILE_RELATIVE,
        readMapDocumentText: () => readActiveMapText(MAP_FILE_RELATIVE),
        readSidecarText: readActiveMapText,
        resolveObjectTexture: resolveObjectTextureReal,
        gameDefsCatalog,
      });
      if (authored) {
        const primaryFloor = authored.floorSources[0];
        if (!primaryFloor) throw new Error('loadAuthoredMap returned no floors.');
        const characterTexture = buildPlaceholderCharacterTexture();
        showStatus(i18n.t('map.loading'));
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
            narrative: authored.narrative,
            props: authored.props,
            lights: authored.lights,
          },
          undefined,
          sessionStores,
        );
        return;
      }
    } catch (error) {
      // Previously this returned here (skipping the DEV fixture below
      // entirely) -- now it falls through, same as every other layer, so a
      // single-file authored failure still leaves the DEV fixture as a last
      // resort in `tauri dev` instead of leaving `main()` with nothing left
      // to try.
      console.error(
        'main: single-file authored map load/render failed; falling back to the DEV fixture.',
        error,
      );
      // Kept for the terminal status below: since C1a a map can parse perfectly
      // and still fail HERE on a dangling narrative reference, a missing `.ink`
      // sidecar or an unseeded `world_get` key -- failures whose messages name
      // the map, the event, the story and the expected path. Reporting those as
      // "no authored map found" told the author the opposite of the truth.
      authoredFailure = describeAuthoredFailure(error);
      showStatus(authoredFailure);
    }
  }

  // `/@fs/` and `server.fs.allow` (vite.config.ts) only exist under `vite
  // dev` -- a production build has no dev server to serve the (git-ignored,
  // never-shipped) DEV-demo fixture from. At this point either no authored map
  // was found at all (every branch above already returned if one rendered), or
  // one was found and REJECTED -- and only in the first case is "no authored
  // map found" the truth. Production has no fixture concept at all.
  if (!import.meta.env.DEV) {
    showStatus(authoredFailure ?? i18n.t('map.noAuthoredMap'));
    return;
  }

  try {
    const data = await loadFixtureMapData();
    statusEl.remove();
    await renderFixtureMap(container, data);
  } catch (error) {
    console.error('Failed to load the Roseliam fixture map:', error);
    // Same reasoning: an authored map that was found and rejected is far more
    // actionable than the fixture's own absence.
    showStatus(authoredFailure ?? i18n.t('map.fixtureNotFound'));
  }
}

main().catch((error: unknown) => {
  console.error('Failed to start ThreeMaker desktop renderer:', error);
});
