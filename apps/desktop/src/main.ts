import { GameLoop } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { GridMover, PassabilityGrid } from '@threemaker/gameplay';
import type { RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
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
import { CharacterSprite, tileCenterToWorld } from './character-sprite.js';
import { fixtureCharacterUrl, fixtureImageUrl, fixtureJsonUrl } from './fixture-paths.js';
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

function assertOk(response: Response): Response {
  if (!response.ok) {
    throw new Error(
      `Fixture request failed: ${response.status} ${response.statusText} (${response.url})`,
    );
  }
  return response;
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

  const usedSheets = (Object.entries(tileset.sheetNames) as [TileSheetId, string][]).filter(
    ([, name]) => name.length > 0,
  );

  const textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  const sheetPixelSizes: SheetPixelSizes = {};
  await Promise.all(
    usedSheets.map(async ([sheet, name]) => {
      const texture = await loadSheetTexture(fixtureImageUrl(__FIXTURES_DIR__, name));
      textures[sheet] = texture;
      const image = texture.image as { width: number; height: number };
      sheetPixelSizes[sheet] = { width: image.width, height: image.height };
    }),
  );

  return { map, tileset, sheetPixelSizes, textures, characterTexture };
}

// World-space size of one tile edge; must match everywhere a world position
// is derived from a tile coordinate (chunk geometry, the character quad).
const TILE_WORLD_SIZE = 1;
// Player movement speed, in tiles/second.
const PLAYER_SPEED = 4;
// How quickly the camera catches up to the character; higher = snappier.
// Framerate-independent exponential smoothing (see `renderFixtureMap`).
const CAMERA_FOLLOW_SPEED = 6;

// HD-2D camera tuning knobs.
const CAMERA_TILT_DEG = 40;
const CAMERA_DISTANCE_FACTOR = 0.9; // distance = max(map width, height) * factor
// Cap the camera boom so a giant map cannot push the camera into the far
// plane; fixture-sized maps stay below the cap and are unaffected.
const CAMERA_MAX_DISTANCE = 24;
const CAMERA_FOV_DEG = 45;

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
function createMostRecentHeldDirection(): { current(): Direction | undefined } {
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

  return { current: () => held[held.length - 1] };
}

/** Everything owned by one loaded map: streamed tilemap, passability, and the character's mover. */
interface MapSession {
  readonly map: RpgmMap;
  readonly tilemap: StreamingTilemapScene;
  readonly streamer: ChunkStreamer;
  readonly mover: GridMover;
  readonly spawn: { readonly x: number; readonly y: number };
  dispose(): void;
}

async function renderFixtureMap(container: HTMLElement, data: FixtureMapData): Promise<void> {
  const { map: fixtureMap, tileset, sheetPixelSizes, textures, characterTexture } = data;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(fixtureMap.width * 0.3, 20, fixtureMap.height * 0.2);
  scene.add(light, new THREE.AmbientLight(0x404060, 2));

  /**
   * Builds a fully wired session for one map: chunk data for the whole map
   * (pure, cheap to keep), a streaming scene that only holds GPU geometry
   * near the character, passability + a spawn tile computed from it (never
   * hardcoded), and the character's grid mover. Textures are shared across
   * sessions (`ownsTextures: false`), so switching maps never reloads them.
   */
  function createMapSession(map: RpgmMap): MapSession {
    const chunks = buildChunks(map, tileset, sheetPixelSizes);
    const tilemap = new StreamingTilemapScene(chunks, textures, {
      tileWorldSize: TILE_WORLD_SIZE,
      ownsTextures: false,
    });
    const streamer = new ChunkStreamer({
      chunkSize: DEFAULT_CHUNK_SIZE,
      mapWidth: map.width,
      mapHeight: map.height,
      buildRadius: STREAM_BUILD_RADIUS,
      disposeRadius: STREAM_DISPOSE_RADIUS,
    });

    const passability = new PassabilityGrid(map, tileset);
    const spawn = findSpawnTile(passability, map.width / 2, map.height / 2);
    const mover = new GridMover({
      x: spawn.x,
      y: spawn.y,
      speed: PLAYER_SPEED,
      canMove: (x, y, direction) => passability.canMove(x, y, direction),
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
      dispose() {
        scene.remove(tilemap.group);
        tilemap.dispose();
      },
    };
  }

  let session = createMapSession(fixtureMap);
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
  );
  scene.add(character.mesh);

  // HD-2D-style tilted perspective: looking down at the map from the south
  // at ~40 degrees. The target starts on the character and smoothly follows
  // it every frame (see the game loop below) instead of a fixed map-center
  // point.
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const tiltAngle = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );

  /** Re-aims the camera boom at the current session's spawn tile (initial view and map switches). */
  function focusCameraOnSpawn(): void {
    const distance = Math.min(
      Math.max(session.map.width, session.map.height) * CAMERA_DISTANCE_FACTOR,
      CAMERA_MAX_DISTANCE,
    );
    offset.set(0, distance * Math.sin(tiltAngle), distance * Math.cos(tiltAngle));
    target.set(
      tileCenterToWorld(session.spawn.x, TILE_WORLD_SIZE),
      0,
      tileCenterToWorld(session.spawn.y, TILE_WORLD_SIZE),
    );
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }
  focusCameraOnSpawn();

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const heldDirection = createMostRecentHeldDirection();

  const hd2d = createHd2dPipeline(renderer, scene, camera);
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
    };
  }
  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.key.toLowerCase() !== 'p') return;
    postProcessingEnabled = !postProcessingEnabled;
    hd2d.setEnabled(postProcessingEnabled);
  });

  // Dev stress toggle: 'g' swaps between the fixture map and a giant
  // deterministic synthetic map (same tileset, so all textures are reused).
  if (import.meta.env.DEV) {
    let giantMap: RpgmMap | undefined;
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.key.toLowerCase() !== 'g') return;
      const toGiant = session.map === fixtureMap;
      if (toGiant) {
        giantMap ??= generateSyntheticMap({
          width: GIANT_MAP_SIZE,
          height: GIANT_MAP_SIZE,
          seed: GIANT_MAP_SEED,
        });
      }
      session.dispose();
      session = createMapSession(toGiant && giantMap ? giantMap : fixtureMap);
      focusCameraOnSpawn();
    });
  }

  // Custom clock, not `THREE.Clock` (deprecated since three r183) -- reuses
  // the engine's own game loop from `@threemaker/core`.
  const gameLoop = new GameLoop({
    onTick(dt) {
      const { mover, streamer, tilemap } = session;
      const direction = heldDirection.current();
      if (direction) mover.requestMove(direction);
      mover.update(dt);

      // Cheap per-frame streaming check: `update` early-exits with an empty
      // diff while the character stays inside the same chunk, so geometry
      // work only happens on chunk-boundary crossings.
      tilemap.applyDiff(streamer.update(mover.tile.x, mover.tile.y));

      if (mover.moving) walkAnimation.update(dt);
      else walkAnimation.reset();

      character.setFrame(mover.facing, walkAnimation.frameColumn(mover.moving));
      character.setTilePosition(mover.renderPosition.x, mover.renderPosition.y, TILE_WORLD_SIZE);
      character.faceCamera(camera);

      // Framerate-independent exponential smoothing: the camera closes a
      // fixed fraction of the remaining distance per second, regardless of
      // how `dt` is chopped into frames.
      const desiredX = tileCenterToWorld(mover.renderPosition.x, TILE_WORLD_SIZE);
      const desiredZ = tileCenterToWorld(mover.renderPosition.y, TILE_WORLD_SIZE);
      const followAmount = 1 - Math.exp(-CAMERA_FOLLOW_SPEED * dt);
      target.x += (desiredX - target.x) * followAmount;
      target.z += (desiredZ - target.z) * followAmount;
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    },
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  await renderer.init();

  const stats = new Stats({ trackGPU: true });
  container.appendChild(stats.dom);
  stats.init(renderer);

  gameLoop.start();
  renderer.setAnimationLoop(() => {
    stats.begin();
    gameLoop.tick();
    hd2d.setFocusDistance(camera.position.distanceTo(character.mesh.position));
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
