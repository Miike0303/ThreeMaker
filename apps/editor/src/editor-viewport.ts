import type { RpgmMap, RpgmTileset, TileSheetId } from '@threemaker/importer-rpgm';
import { parseMap, parseTilesets } from '@threemaker/importer-rpgm';
import type { SheetPixelSizes } from '@threemaker/renderer';
import { buildChunks, loadSheetTexture, TilemapScene } from '@threemaker/renderer';
import * as THREE from 'three';
import { mzFixtureImageUrl, mzFixtureJsonUrl } from './fixture-paths.js';
import { computeOverviewCameraDistance, computeOverviewCameraPose } from './viewer-camera.js';

const MZ_FIXTURE_MAP_ID = 1;
const MZ_FIXTURE_MAP_FILE = 'Map001.json';
const TILE_WORLD_SIZE = 1;
const OVERVIEW_TILT_DEG = 45;
// Higher than apps/desktop's follow-camera factor (0.9) -- that camera
// frames a small radius around a walking character, while this viewer must
// fit the WHOLE map in view at once with no player to focus on.
const OVERVIEW_DISTANCE_FACTOR = 1.6;
const OVERVIEW_MAX_DISTANCE = 60;
const OVERVIEW_FOV_DEG = 45;

function assertOk(response: Response): Response {
  if (!response.ok) {
    throw new Error(
      `Fixture request failed: ${response.status} ${response.statusText} (${response.url})`,
    );
  }
  return response;
}

/**
 * Imperative, non-React map viewport: loads the bundled mz-project1 fixture
 * map (see module doc in fixture-paths.ts for why a fixture, not a
 * catalog-composed map, this slice) and renders it with the existing
 * `TilemapScene` (whole-map build, no streaming needed for a static viewer)
 * behind a fixed overview camera. No player, no painting -- both land in
 * Slice 4. Mounted by `MapViewer.tsx` inside a `useEffect`, matching the
 * repo's "plain-TS class, thin React wrapper" convention (design's "Editor
 * framework" decision: viewport stays imperative, no react-three-fiber).
 */
export class EditorViewport {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private tilemap: TilemapScene | undefined;
  private animationHandle: number | undefined;
  private readonly onResize = () => this.handleResize();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.add(new THREE.AmbientLight(0x808090, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, 20, 10);
    this.scene.add(light);

    this.camera = new THREE.PerspectiveCamera(
      OVERVIEW_FOV_DEG,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      500,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', this.onResize);
  }

  /** Loads and renders the fixture map. Throws in production builds (no `/@fs/` dev endpoint) -- callers show a localized message instead. */
  async loadFixtureMap(fixturesDir: string): Promise<void> {
    const [mapJson, tilesetsJson] = await Promise.all([
      fetch(mzFixtureJsonUrl(fixturesDir, MZ_FIXTURE_MAP_FILE)).then((res) => assertOk(res).json()),
      fetch(mzFixtureJsonUrl(fixturesDir, 'Tilesets.json')).then((res) => assertOk(res).json()),
    ]);

    const map: RpgmMap = parseMap(mapJson, MZ_FIXTURE_MAP_ID);
    const tilesets: RpgmTileset[] = parseTilesets(tilesetsJson);
    const tileset = tilesets.find((entry) => entry.id === map.tilesetId);
    if (!tileset) throw new Error(`Tileset ${map.tilesetId} not found for ${MZ_FIXTURE_MAP_FILE}.`);

    const usedSheets = (Object.entries(tileset.sheetNames) as [TileSheetId, string][]).filter(
      ([, name]) => name.length > 0,
    );
    const textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
    const sheetPixelSizes: SheetPixelSizes = {};
    await Promise.all(
      usedSheets.map(async ([sheet, name]) => {
        const texture = await loadSheetTexture(mzFixtureImageUrl(fixturesDir, name));
        textures[sheet] = texture;
        const image = texture.image as { width: number; height: number };
        sheetPixelSizes[sheet] = { width: image.width, height: image.height };
      }),
    );

    const chunks = buildChunks(map, tileset, sheetPixelSizes);
    this.tilemap?.dispose();
    this.tilemap = new TilemapScene(chunks, textures, { tileWorldSize: TILE_WORLD_SIZE });
    this.scene.add(this.tilemap.group);

    this.frameCamera(map.width, map.height);
    this.startRenderLoop();
  }

  private frameCamera(mapWidth: number, mapHeight: number): void {
    const distance = computeOverviewCameraDistance(
      mapWidth,
      mapHeight,
      OVERVIEW_DISTANCE_FACTOR,
      OVERVIEW_MAX_DISTANCE,
    );
    const centerX = (mapWidth * TILE_WORLD_SIZE) / 2;
    const centerZ = (mapHeight * TILE_WORLD_SIZE) / 2;
    const pose = computeOverviewCameraPose(centerX, centerZ, OVERVIEW_TILT_DEG, distance);
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  }

  private startRenderLoop(): void {
    if (this.animationHandle !== undefined) return;
    const renderFrame = () => {
      this.renderer.render(this.scene, this.camera);
      this.animationHandle = requestAnimationFrame(renderFrame);
    };
    renderFrame();
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    if (this.animationHandle !== undefined) cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.onResize);
    this.tilemap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
