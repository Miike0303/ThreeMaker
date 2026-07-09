import { GameLoop } from '@threemaker/core';
import type { RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import type { SheetPixelSizes } from '@threemaker/renderer';
import { buildChunks, loadSheetTexture, TilemapScene } from '@threemaker/renderer';
import Stats from 'stats-gl';
import * as THREE from 'three/webgpu';
import { fixtureImageUrl, fixtureJsonUrl } from './fixture-paths.js';
import type { Locale } from './i18n.js';
import { createI18n } from './i18n.js';

// The Roseliam fixture (see fixtures/README.md) ships 3 sample maps; Map007
// is the nicest of the three for this slice (a dungeon interior with both
// ground and upper-layer/"star" tiles).
const FIXTURE_MAP_ID = 7;
const FIXTURE_MAP_FILE = 'Map007.json';

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
 * Loads Map007 + its tileset from the Roseliam fixture over Vite's dev-only
 * `/@fs/` endpoint (see fixture-paths.ts and vite.config.ts) and loads every
 * sheet texture it references. Throws if the fixture folder is missing or
 * this isn't a dev server (`__FIXTURES_DIR__` still resolves, but `/@fs/`
 * only exists under `vite dev`) -- callers show a localized message instead
 * of letting this crash the app.
 */
async function loadFixtureMapData(): Promise<FixtureMapData> {
  const [mapJson, tilesetsJson] = await Promise.all([
    fetch(fixtureJsonUrl(__FIXTURES_DIR__, FIXTURE_MAP_FILE)).then((res) => assertOk(res).json()),
    fetch(fixtureJsonUrl(__FIXTURES_DIR__, 'Tilesets.json')).then((res) => assertOk(res).json()),
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

  return { map, tileset, sheetPixelSizes, textures };
}

/** WASD/arrow keys pan the camera target; movement speed is in world units/second. */
const PAN_SPEED = 6;

// HD-2D camera tuning knobs.
const CAMERA_TILT_DEG = 40;
const CAMERA_DISTANCE_FACTOR = 0.9; // distance = max(map width, height) * factor
const CAMERA_FOV_DEG = 45;
const PAN_KEYS: Record<string, readonly [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

async function renderFixtureMap(container: HTMLElement, data: FixtureMapData): Promise<void> {
  const { map, tileset, sheetPixelSizes, textures } = data;

  const chunks = buildChunks(map, tileset, sheetPixelSizes);
  const tilemap = new TilemapScene(chunks, textures);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.add(tilemap.group);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(map.width * 0.3, 20, map.height * 0.2);
  scene.add(light, new THREE.AmbientLight(0x404060, 2));

  // HD-2D-style tilted perspective: looking down at the map from the south
  // at ~40 degrees.
  const target = new THREE.Vector3(map.width / 2, 0, map.height / 2);
  const tiltAngle = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
  const distance = Math.max(map.width, map.height) * CAMERA_DISTANCE_FACTOR;
  const offset = new THREE.Vector3(
    0,
    distance * Math.sin(tiltAngle),
    distance * Math.cos(tiltAngle),
  );

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.copy(target).add(offset);
  camera.lookAt(target);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const pressedKeys = new Set<string>();
  window.addEventListener('keydown', (event) => pressedKeys.add(event.key.toLowerCase()));
  window.addEventListener('keyup', (event) => pressedKeys.delete(event.key.toLowerCase()));

  // Custom clock, not `THREE.Clock` (deprecated since three r183) -- reuses
  // the engine's own game loop from `@threemaker/core`.
  const gameLoop = new GameLoop({
    onTick(dt) {
      let dx = 0;
      let dz = 0;
      for (const key of pressedKeys) {
        const direction = PAN_KEYS[key];
        if (!direction) continue;
        dx += direction[0];
        dz += direction[1];
      }
      if (dx !== 0 || dz !== 0) {
        target.x += dx * PAN_SPEED * dt;
        target.z += dz * PAN_SPEED * dt;
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
      }
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
    renderer.render(scene, camera);
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
