import type { RampDirection, TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument, SemanticClass, TileDiff } from '@threemaker/map-format';
import type { ChunkBuildData, SheetPixelSizes } from '@threemaker/renderer';
import {
  buildChunks,
  chunkKey,
  DEFAULT_CHUNK_SIZE,
  loadSheetTexture,
  StreamingTilemapScene,
} from '@threemaker/renderer';
import * as THREE from 'three';
import { objectPreviewUrl } from './catalog-client.js';
import { computeDirtyChunkKeys } from './dirty-region.js';
import {
  composeDocumentFromPainterFloors,
  painterFloorsFromDocument,
  toRenderableMap,
  toRenderableTileset,
} from './map-compose.js';
import type { PainterState } from './painter-store.js';
import * as painter from './painter-store.js';
import { computeRampGlyphCells } from './ramp-glyph.js';
import type { TilePoint, ToolId } from './tool-sm.js';
import { resolveToolShortcut } from './tool-sm.js';
import type { OverviewCameraPose } from './viewer-camera.js';
import {
  computeOverviewCameraDistance,
  computeOverviewCameraPose,
  projectToScreenFraction,
} from './viewer-camera.js';

/** Loads a texture (+ its pixel size) for every composed slot that has a resolved object hash. Thin IO glue, untested per this module's convention. */
export async function loadSlotTextures(doc: MapDocument): Promise<{
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly sheetPixelSizes: SheetPixelSizes;
}> {
  const textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  const sheetPixelSizes: SheetPixelSizes = {};
  await Promise.all(
    Object.entries(doc.tileset.slots).map(async ([slot, source]) => {
      if (!source?.object) return;
      const url = await objectPreviewUrl(source.object, 'png');
      const texture = await loadSheetTexture(url);
      const sheetId = slot as TileSheetId;
      textures[sheetId] = texture;
      const image = texture.image as { width: number; height: number };
      sheetPixelSizes[sheetId] = { width: image.width, height: image.height };
    }),
  );
  return { textures, sheetPixelSizes };
}

const TILE_WORLD_SIZE = 1;
const OVERVIEW_TILT_DEG = 45;
const OVERVIEW_DISTANCE_FACTOR = 1.6;
const OVERVIEW_MAX_DISTANCE = 60;
const OVERVIEW_FOV_DEG = 45;

/** One ramp cell's display-only direction glyph, already projected to a screen-space fraction (see `viewer-camera.ts`'s `projectToScreenFraction`) for the surrounding UI to position a DOM label with, no camera object needed. */
export interface RampGlyphOverlayItem {
  readonly x: number;
  readonly y: number;
  readonly direction: RampDirection;
  readonly xFrac: number;
  readonly yFrac: number;
}

export interface PainterViewportCallbacks {
  /** Fired after every painter-store transition (tool switch, stroke commit, undo/redo, semantic assignment...) so the surrounding UI can re-render its toolbar/inspector. */
  readonly onStateChange?: (state: PainterState) => void;
  /** Fired when the eyedropper picks a tile id, so the UI can update the active fill tile display. */
  readonly onPicked?: (tileId: number) => void;
  /** Fired whenever the set (or screen position) of ramp-direction glyphs changes: on map load, after a semantic-mode stroke commits, and on resize (see `recomputeRampGlyphs`). */
  readonly onRampGlyphsChange?: (glyphs: readonly RampGlyphOverlayItem[]) => void;
}

/**
 * Imperative paint-capable viewport: mounts a `StreamingTilemapScene` for a
 * `MapDocument`, wires pointer events to `painter-store`'s tool state
 * machine, and applies committed strokes as SCOPED live updates via
 * `dirty-region.ts` + `buildChunks(onlyChunks)` + `patchChunks` -- never a
 * full-map rebuild per stroke (spec: "Scoped live update").
 *
 * Untested per this repo's imperative-viewport convention (see
 * `editor-viewport.ts`) -- every pure computation it delegates to
 * (`painter-store.ts`, `dirty-region.ts`, `map-compose.ts`) is unit tested.
 */
export class PainterViewport {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly callbacks: PainterViewportCallbacks;
  private readonly onResize = () => this.handleResize();
  private readonly onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
  private readonly onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
  private readonly onPointerUp = () => this.handlePointerUp();
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);

  private tilemap: StreamingTilemapScene | undefined;
  private animationHandle: number | undefined;
  private doc: MapDocument | undefined;
  private sheetPixelSizes: SheetPixelSizes = {};
  private textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  private state: PainterState | undefined;
  /** Set by `frameCamera`; the overview camera never pans/zooms afterward, so this stays valid for the whole session (see `recomputeRampGlyphs`). */
  private cameraPose: OverviewCameraPose | undefined;

  constructor(container: HTMLElement, callbacks: PainterViewportCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
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
    window.addEventListener('keydown', this.onKeyDown);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  get painterState(): PainterState | undefined {
    return this.state;
  }

  /** Mounts `doc`, building every chunk of its ACTIVE (floor 0, ground) floor with data live up front (a bounded authoring map, not a streamed world). Every floor is loaded into the painter store (spec: floor switcher), but only the active floor's chunks are ever built (spec: "editor viewport shows active floor only"). */
  loadMap(
    doc: MapDocument,
    textures: Partial<Record<TileSheetId, THREE.Texture>>,
    sheetPixelSizes: SheetPixelSizes,
    fillTileId: number,
  ): void {
    this.doc = doc;
    this.sheetPixelSizes = sheetPixelSizes;
    this.textures = textures;
    this.state = painter.createPainterState({
      floors: painterFloorsFromDocument(doc),
      width: doc.width,
      height: doc.height,
      fillTileId,
      semantics: doc.tileset.semantics,
    });

    this.rebuildActiveFloorScene();
    this.frameCamera(doc.width, doc.height);
    this.startRenderLoop();
    this.emitState();
    this.recomputeRampGlyphs();
  }

  /** Adds a new blank floor on top of the stack and makes it active (spec: "adding a floor"). No-op if no map is loaded. */
  addFloor(id: string, label?: string): void {
    if (!this.state) return;
    this.state = painter.addFloor(this.state, label === undefined ? { id } : { id, label });
    this.rebuildActiveFloorScene();
    this.emitState();
    this.recomputeRampGlyphs();
  }

  /** Switches the active floor; the viewport re-renders showing ONLY that floor (spec: "editor viewport shows active floor only"). Ignored mid-stroke/out-of-range (see `painter.selectFloor`). */
  selectFloor(index: number): void {
    if (!this.state) return;
    const next = painter.selectFloor(this.state, index);
    if (next === this.state) return;
    this.state = next;
    this.rebuildActiveFloorScene();
    this.emitState();
    this.recomputeRampGlyphs();
  }

  /** Removes the floor at `index` (min 1 floor enforced; see `painter.removeFloor`). Ignored mid-stroke/out-of-range/last-floor. */
  removeFloor(index: number): void {
    if (!this.state) return;
    const next = painter.removeFloor(this.state, index);
    if (next === this.state) return;
    this.state = next;
    this.rebuildActiveFloorScene();
    this.emitState();
    this.recomputeRampGlyphs();
  }

  setTool(tool: ToolId): void {
    if (!this.state) return;
    this.state = painter.setTool(this.state, tool);
    this.emitState();
  }

  setActiveLayer(layer: 0 | 1 | 2 | 3): void {
    if (!this.state) return;
    this.state = painter.setActiveLayer(this.state, layer);
    this.emitState();
  }

  setFillTileId(tileId: number): void {
    if (!this.state) return;
    this.state = painter.setFillTileId(this.state, tileId);
    this.emitState();
  }

  setSemanticMode(enabled: boolean): void {
    if (!this.state) return;
    this.state = painter.setSemanticMode(this.state, enabled);
    this.emitState();
  }

  setSemanticClass(cls: SemanticClass): void {
    if (!this.state) return;
    this.state = painter.setSemanticClass(this.state, cls);
    this.emitState();
  }

  undo(): void {
    if (!this.state) return;
    const result = painter.undo(this.state);
    this.state = result.state;
    if (result.diff) this.applyDiffLiveUpdate(result.diff);
    this.emitState();
  }

  redo(): void {
    if (!this.state) return;
    const result = painter.redo(this.state);
    this.state = result.state;
    if (result.diff) this.applyDiffLiveUpdate(result.diff);
    this.emitState();
  }

  /** The current map state (ALL floors' layers + semantics), for saving -- not just the active floor. `undefined` if no map is loaded. */
  currentDocument(): MapDocument | undefined {
    if (!this.doc || !this.state) return undefined;
    const composed = composeDocumentFromPainterFloors(this.doc, this.state.floors);
    return {
      ...composed,
      tileset: { ...composed.tileset, semantics: this.state.semantics },
    };
  }

  private pickTile(event: PointerEvent): TilePoint | undefined {
    if (!this.doc) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return undefined;

    const tileX = Math.floor(point.x / TILE_WORLD_SIZE);
    const tileY = Math.floor(point.z / TILE_WORLD_SIZE);
    if (tileX < 0 || tileX >= this.doc.width || tileY < 0 || tileY >= this.doc.height) {
      return undefined;
    }
    return { x: tileX, y: tileY };
  }

  private handlePointerDown(event: PointerEvent): void {
    if (!this.state) return;
    const point = this.pickTile(event);
    if (!point) return;
    const result = painter.pointerDown(this.state, point);
    this.state = result.state;
    if (result.pickedTileId !== undefined) this.callbacks.onPicked?.(result.pickedTileId);
    this.emitState();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.state?.stroke.status !== 'stroking') return;
    const point = this.pickTile(event);
    if (!point) return;
    this.state = painter.pointerMove(this.state, point);
  }

  private handlePointerUp(): void {
    if (!this.state) return;
    const result = painter.pointerUp(this.state);
    this.state = result.state;
    if (result.diff) this.applyDiffLiveUpdate(result.diff);
    if (result.semanticTileIds) this.recomputeRampGlyphs();
    this.emitState();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;
    const tool = resolveToolShortcut(event.key);
    if (tool) this.setTool(tool);
  }

  /**
   * Fully rebuilds the tilemap scene from the ACTIVE floor only (spec:
   * "editor viewport shows active floor only") -- used on initial load AND
   * every floor add/select/remove, since a floor switch is a full re-scope
   * of what's visible/editable, not a scoped diff. Reuses the already-
   * loaded `this.textures`/`this.sheetPixelSizes` (shared tileset across
   * floors, per spec: "catalog/palette stays floor-agnostic").
   */
  private rebuildActiveFloorScene(): void {
    if (!this.doc || !this.state) return;
    const composed = composeDocumentFromPainterFloors(this.doc, this.state.floors);
    const map = toRenderableMap(composed, this.state.activeFloor);
    const tileset = toRenderableTileset(composed);
    const chunks = buildChunks(map, tileset, this.sheetPixelSizes);

    this.tilemap?.dispose();
    this.tilemap = new StreamingTilemapScene(chunks, this.textures, {
      tileWorldSize: TILE_WORLD_SIZE,
    });
    for (const chunk of chunks) this.tilemap.buildChunk(chunkKey(chunk.chunkX, chunk.chunkY));
    this.scene.add(this.tilemap.group);
  }

  /** Scoped live update on the ACTIVE floor: dirty-region -> buildChunks(onlyChunks) -> patchChunks, plus explicit buildChunk for any dirty chunk not yet live (a from-scratch blank map starts with zero live chunks). */
  private applyDiffLiveUpdate(diff: TileDiff): void {
    if (!this.doc || !this.state || !this.tilemap) return;
    const composed = composeDocumentFromPainterFloors(this.doc, this.state.floors);
    const map = toRenderableMap(composed, this.state.activeFloor);
    const tileset = toRenderableTileset(composed);

    const dirtyKeys = computeDirtyChunkKeys(diff.cells, map, tileset, DEFAULT_CHUNK_SIZE);
    if (dirtyKeys.size === 0) return;

    const rebuilt = buildChunks(map, tileset, this.sheetPixelSizes, DEFAULT_CHUNK_SIZE, dirtyKeys);
    const rebuiltKeys = new Set(rebuilt.map((chunk) => chunkKey(chunk.chunkX, chunk.chunkY)));
    const cleared: ChunkBuildData[] = [];
    for (const key of dirtyKeys) {
      if (rebuiltKeys.has(key)) continue;
      const [xPart, yPart] = key.split(',');
      cleared.push({ chunkX: Number(xPart), chunkY: Number(yPart), tiles: [] });
    }

    const patched = [...rebuilt, ...cleared];
    this.tilemap.patchChunks(patched);
    for (const chunk of patched) this.tilemap.buildChunk(chunkKey(chunk.chunkX, chunk.chunkY));
  }

  private emitState(): void {
    if (this.state) this.callbacks.onStateChange?.(this.state);
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
    this.cameraPose = pose;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  }

  /**
   * Recomputes the display-only ramp-direction glyph overlay (design:
   * "Painter" -- glyph reflects auto/overridden direction, no picker input)
   * and pushes it to `onRampGlyphsChange`. Cheap: painter maps are small,
   * bounded authoring maps, never the streamed-world scale `main.ts` deals
   * with.
   */
  private recomputeRampGlyphs(): void {
    if (!this.doc || !this.state || !this.cameraPose) return;
    const composed = composeDocumentFromPainterFloors(this.doc, this.state.floors);
    const activeFloor = composed.floors[this.state.activeFloor];
    if (!activeFloor) return;
    const cells = computeRampGlyphCells(
      painter.activeFloorState(this.state).layers,
      activeFloor.layers.regions,
      this.state.semantics,
      this.doc.width,
      this.doc.height,
    );
    const glyphs: RampGlyphOverlayItem[] = [];
    for (const cell of cells) {
      const projected = projectToScreenFraction(
        { x: cell.x + 0.5, y: 0, z: cell.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      glyphs.push({ ...cell, xFrac: projected.xFrac, yFrac: projected.yFrac });
    }
    this.callbacks.onRampGlyphsChange?.(glyphs);
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
    this.recomputeRampGlyphs();
  }

  dispose(): void {
    if (this.animationHandle !== undefined) cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.tilemap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
