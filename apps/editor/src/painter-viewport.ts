import type { RampDirection, TileSheetId } from '@threemaker/importer-rpgm';
import type {
  LightDocument,
  MapDocument,
  NpcFacing,
  SemanticClass,
  TileDiff,
  WorldSeedValue,
} from '@threemaker/map-format';
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
import { computeLightOverlayPoints } from './light-overlay.js';
import {
  composeDocumentFromPainterFloors,
  normalizeMapName,
  painterFloorsFromDocument,
  toRenderableMap,
  toRenderableTileset,
} from './map-compose.js';
import { computeNpcOverlayPoints } from './npc-overlay.js';
import type { PainterState } from './painter-store.js';
import * as painter from './painter-store.js';
import { computePropOverlayPoints } from './prop-overlay.js';
import { computeRampGlyphCells } from './ramp-glyph.js';
import { computeRoomOverlayRects, roomRectCorners } from './room-overlay.js';
import { computeSpawnOverlayPoint } from './spawn-overlay.js';
import { computeStairOverlayPoints } from './stair-overlay.js';
import type { EditableTargetLike, TilePoint, ToolId } from './tool-sm.js';
import { resolveEditorChord, resolveToolShortcut, shouldIgnoreToolShortcut } from './tool-sm.js';
import { computeTriggerOverlayPoints } from './trigger-overlay.js';
import type { OverviewCameraPose } from './viewer-camera.js';
import {
  computeOverviewCameraDistance,
  computeOverviewCameraPose,
  panCameraTarget,
  projectToScreenFraction,
  zoomCameraDistance,
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
/** Wheel-zoom bounds relative to the map's framing distance (`computeOverviewCameraDistance`), WU-UX-01. */
const ZOOM_MIN_DISTANCE_FACTOR = 0.2;
const ZOOM_MAX_DISTANCE_FACTOR = 2.5;

/** One ramp cell's display-only direction glyph, already projected to a screen-space fraction (see `viewer-camera.ts`'s `projectToScreenFraction`) for the surrounding UI to position a DOM label with, no camera object needed. */
export interface RampGlyphOverlayItem {
  readonly x: number;
  readonly y: number;
  readonly direction: RampDirection;
  readonly xFrac: number;
  readonly yFrac: number;
}

/** One authored room rect's display-only overlay outline (Slice 5b design: "viewport overlay outlines rooms on the active floor"), an axis-aligned screen-space bounding box of the rect's 4 tile-space corners (`room-overlay.ts`'s `roomRectCorners`), each individually projected via `projectToScreenFraction` -- an approximation of the (generally quadrilateral, given the tilted overview camera) true projected footprint, acceptable for a display-only "there is a room here" outline. Distinct from `RampGlyphOverlayItem`: rooms render as an outlined box, not a point glyph. */
export interface RoomOverlayItem {
  readonly roomId: string;
  readonly roomName?: string;
  readonly leftFrac: number;
  readonly topFrac: number;
  readonly widthFrac: number;
  readonly heightFrac: number;
}

/** One stair-link marker (entry OR exit, see `stair-overlay.ts`'s `StairOverlayRole`) touching the active floor, projected to a screen-space fraction -- a point glyph like `RampGlyphOverlayItem`, not an outlined box like `RoomOverlayItem`. */
export interface StairOverlayItem {
  readonly linkId: string;
  readonly role: 'entry' | 'exit';
  readonly bidirectional: boolean;
  readonly xFrac: number;
  readonly yFrac: number;
}

/** The single authored spawn marker, projected to a screen-space fraction, when it sits on the active floor (see `spawn-overlay.ts`). `undefined` when unauthored or authored on a different floor. */
export interface SpawnOverlayItem {
  readonly xFrac: number;
  readonly yFrac: number;
}

/** One prop marker on the active floor, projected to a screen-space fraction (see `prop-overlay.ts`). */
export interface PropOverlayItem {
  readonly id: string;
  readonly xFrac: number;
  readonly yFrac: number;
}

/** One NPC marker on the active floor, projected to a screen-space fraction (see `npc-overlay.ts`). */
export interface NpcOverlayItem {
  readonly id: string;
  readonly xFrac: number;
  readonly yFrac: number;
}

/** One trigger marker on the active floor, projected to a screen-space fraction (see `trigger-overlay.ts`). */
export interface TriggerOverlayItem {
  readonly id: string;
  readonly xFrac: number;
  readonly yFrac: number;
}

/** One placed light marker on the active floor (see `light-overlay.ts`). */
export interface LightOverlayItem {
  readonly id: string;
  readonly xFrac: number;
  readonly yFrac: number;
  readonly kind: LightDocument['kind'];
  readonly color: string;
}

/** The tile under the pointer while NOT stroking (WU-UX-04): tile coords for the status-bar readout plus the projected screen fraction for the highlight marker (so it re-projects on camera zoom/pan/resize like every other overlay). */
export interface HoverOverlayItem {
  readonly x: number;
  readonly y: number;
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
  /** Fired whenever the active floor's authored room overlay changes: on map load, floor switch, resize, and after any room-box stroke/room CRUD op commits (see `recomputeRoomOverlay`). */
  readonly onRoomOverlayChange?: (rooms: readonly RoomOverlayItem[]) => void;
  /** Fired whenever the active floor's stair-link marker overlay changes: on map load, floor switch, resize, and after any stair-link click/removal/toggle (see `recomputeStairOverlay`). */
  readonly onStairOverlayChange?: (points: readonly StairOverlayItem[]) => void;
  /** Fired whenever the active floor's spawn marker overlay changes: on map load, floor switch, resize, and after any spawn placement/clear (see `recomputeSpawnOverlay`). */
  readonly onSpawnOverlayChange?: (point: SpawnOverlayItem | undefined) => void;
  /** Fired whenever the active floor's prop markers change: on map load, floor switch, resize, and after any prop place/remove (see `recomputePropOverlay`). */
  readonly onPropOverlayChange?: (points: readonly PropOverlayItem[]) => void;
  /** Fired whenever the active floor's NPC markers change (c1a follow-up). */
  readonly onNpcOverlayChange?: (points: readonly NpcOverlayItem[]) => void;
  /** Fired whenever the active floor's trigger markers change (c1a follow-up). */
  readonly onTriggerOverlayChange?: (points: readonly TriggerOverlayItem[]) => void;
  /** Fired whenever the active floor's light markers change (schema v6 WU-LIGHT-02). */
  readonly onLightOverlayChange?: (points: readonly LightOverlayItem[]) => void;
  /** Fired when the hovered tile changes while not stroking (WU-UX-04): the picked tile + its screen projection, or `null` when the pointer leaves the canvas / misses the map. Also re-fired (re-projected) on camera zoom/pan/resize. */
  readonly onHoverChange?: (tile: HoverOverlayItem | null) => void;
  /** Fired on the Ctrl/Cmd+S chord (WU-UX-03) so the surrounding UI can run its existing Save flow. */
  readonly onSaveRequest?: () => void;
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
  private readonly onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
  private readonly onPointerLeave = () => this.updateHoverTile(undefined);
  private readonly onWheel = (event: WheelEvent) => this.handleWheel(event);
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);

  private tilemap: StreamingTilemapScene | undefined;
  private animationHandle: number | undefined;
  private doc: MapDocument | undefined;
  private sheetPixelSizes: SheetPixelSizes = {};
  private textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  private state: PainterState | undefined;
  /** Set by `frameCamera` and updated by every wheel-zoom/drag-pan (`applyCameraPose`); every overlay projection reads it, and every camera change re-fires the shared `recomputeOverlays` path (WU-UX-01). */
  private cameraPose: OverviewCameraPose | undefined;
  /** The map's framing distance (`computeOverviewCameraDistance`), the reference the wheel-zoom bounds scale from. Reset by `frameCamera` on every load. */
  private referenceCameraDistance = 0;
  /** Current camera boom distance (wheel-zoom state, WU-UX-01). */
  private cameraDistance = 0;
  /** Current camera look-at target on the ground plane (drag-pan state, WU-UX-01). */
  private cameraTargetX = 0;
  private cameraTargetZ = 0;
  /** In-progress middle-button drag-pan, if any (WU-UX-01). */
  private panState: { pointerId: number; lastX: number; lastY: number } | undefined;
  /** The tile currently under the pointer while not stroking (WU-UX-04); `undefined` off-map/off-canvas. */
  private hoverTile: TilePoint | undefined;

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
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    // passive: false so wheel-zoom can preventDefault the page scroll (WU-UX-01).
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
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
      rooms: doc.rooms,
      stairLinks: doc.stairLinks,
      props: doc.props,
      npcs: doc.npcs,
      triggers: doc.triggers,
      lights: doc.lights,
      events: { ...doc.events },
      worldSeeds: { ...doc.worldSeeds },
      ...(doc.spawn !== undefined ? { spawn: doc.spawn } : {}),
    });

    this.rebuildActiveFloorScene();
    this.frameCamera(doc.width, doc.height);
    this.startRenderLoop();
    this.emitState();
    // The previous document's hovered tile may not exist on this one; drop it before overlays re-project.
    this.updateHoverTile(undefined);
    this.recomputeOverlays();
  }

  /** Adds a new blank floor on top of the stack and makes it active (spec: "adding a floor"). No-op if no map is loaded. */
  addFloor(id: string, label?: string): void {
    if (!this.state) return;
    this.applyFloorMutation(
      painter.addFloor(this.state, label === undefined ? { id } : { id, label }),
    );
  }

  /** Switches the active floor; the viewport re-renders showing ONLY that floor (spec: "editor viewport shows active floor only"). Ignored mid-stroke/out-of-range (see `painter.selectFloor`). */
  selectFloor(index: number): void {
    if (!this.state) return;
    const next = painter.selectFloor(this.state, index);
    if (next === this.state) return;
    this.applyFloorMutation(next);
  }

  /** Removes the floor at `index` (min 1 floor enforced; see `painter.removeFloor`). Ignored mid-stroke/out-of-range/last-floor. */
  removeFloor(index: number): void {
    if (!this.state) return;
    const next = painter.removeFloor(this.state, index);
    if (next === this.state) return;
    this.applyFloorMutation(next);
  }

  /**
   * Sets or clears the optional display label on floor `index` (WU-UX-08).
   * Empty/whitespace clears. No-op when unchanged / mid-stroke / OOB.
   * Label-only: no scene rebuild required (dropdown + compose use state).
   */
  setFloorLabel(index: number, label: string | undefined): void {
    if (!this.state) return;
    const next = painter.setFloorLabel(this.state, index, label);
    if (next === this.state) return;
    this.state = next;
    this.emitState();
  }

  /**
   * Shared pipeline for every floor-structure change (add/select/remove):
   * adopt `next` as the current state, rebuild the active floor's scene
   * from scratch, and re-emit state/ramp-glyphs. Every floor-structure
   * change goes through this exact sequence -- see `addFloor`/
   * `selectFloor`/`removeFloor` above, each of which only computes `next`
   * via its own `painter.*` mutator (and, for `selectFloor`/`removeFloor`,
   * its own pre-existing no-op guard when the mutator left state
   * unchanged -- out of range, mid-stroke, or last-floor removal).
   */
  private applyFloorMutation(next: PainterState): void {
    this.state = next;
    this.rebuildActiveFloorScene();
    this.emitState();
    this.recomputeOverlays();
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

  /** Sets (or, with `undefined`, clears) the room the next 'room-box' stroke extends (Slice 5b). */
  setActiveRoomId(id: string | undefined): void {
    if (!this.state) return;
    this.state = painter.setActiveRoomId(this.state, id);
    this.emitState();
  }

  renameRoom(id: string, name: string | undefined): void {
    if (!this.state) return;
    this.state = painter.renameRoom(this.state, id, name);
    this.emitState();
    this.recomputeRoomOverlay();
  }

  removeRoom(id: string): void {
    if (!this.state) return;
    this.state = painter.removeRoom(this.state, id);
    this.emitState();
    this.recomputeRoomOverlay();
  }

  /** Undoes the most recent room command on the active floor's OWN room-command stack (spec: "per-floor undo isolation") -- a separate Ctrl+Z namespace from tile edits, see `undo`/`redo` above. */
  undoRoom(): void {
    if (!this.state) return;
    this.state = painter.undoRoom(this.state).state;
    this.emitState();
    this.recomputeRoomOverlay();
  }

  redoRoom(): void {
    if (!this.state) return;
    this.state = painter.redoRoom(this.state).state;
    this.emitState();
    this.recomputeRoomOverlay();
  }

  /** Removes the stair-link `id` (Slice 5b panel action) -- this IS the undo for stair-link authoring, see `painter-store.ts`'s module doc comment. */
  removeStairLink(id: string): void {
    if (!this.state) return;
    this.state = painter.removeStairLink(this.state, id);
    this.emitState();
    this.recomputeStairOverlay();
  }

  /** Flips the `bidirectional` flag on the stair-link `id` (Slice 5b panel action). */
  toggleStairLinkBidirectional(id: string): void {
    if (!this.state) return;
    this.state = painter.toggleStairLinkBidirectional(this.state, id);
    this.emitState();
    this.recomputeStairOverlay();
  }

  /** Clears the authored spawn (Slice 5b panel action) -- overwriting/clearing IS the undo, see `painter-store.ts`'s module doc comment. */
  clearSpawn(): void {
    if (!this.state) return;
    this.state = painter.clearSpawn(this.state);
    this.emitState();
    this.recomputeSpawnOverlay();
  }

  /** Sets the content-addressed sha of the currently selected ingested `.glb` for the prop tool (C5 WU-04). */
  setActivePropObject(object: string | undefined): void {
    if (!this.state) return;
    this.state = painter.setActivePropObject(this.state, object);
    this.emitState();
  }

  /** Removes the prop `id` from the active floor (C5 WU-04 panel action). */
  removeProp(id: string): void {
    if (!this.state) return;
    this.state = painter.removeProp(this.state, id);
    this.emitState();
    this.recomputePropOverlay();
  }

  /**
   * Panel "Place at tile" for props — same store path as a prop-tool canvas
   * click (stroke-cancel + place). Does not require the prop tool to be active.
   */
  placePropAtTile(x: number, y: number): void {
    if (!this.state) return;
    this.state = painter.placePropAtTile(this.state, { x, y });
    this.emitState();
    this.recomputePropOverlay();
  }

  /** Sets the selected NPC sprite sheet sha for the npc tool (c1a follow-up). */
  setActiveNpcSpriteObject(object: string | undefined): void {
    if (!this.state) return;
    this.state = painter.setActiveNpcSpriteObject(this.state, object);
    this.emitState();
  }

  setActiveNpcCharacterIndex(index: number): void {
    if (!this.state) return;
    this.state = painter.setActiveNpcCharacterIndex(this.state, index);
    this.emitState();
  }

  setActiveNpcFacing(facing: NpcFacing): void {
    if (!this.state) return;
    this.state = painter.setActiveNpcFacing(this.state, facing);
    this.emitState();
  }

  setActiveNpcEventKey(key: string | undefined): void {
    if (!this.state) return;
    this.state = painter.setActiveNpcEventKey(this.state, key);
    this.emitState();
  }

  /** Removes the NPC `id` from the active floor (c1a follow-up panel action). */
  removeNpc(id: string): void {
    if (!this.state) return;
    this.state = painter.removeNpc(this.state, id);
    this.emitState();
    this.recomputeNpcOverlay();
  }

  /**
   * Panel "Place at tile" for NPCs — same store path as an npc-tool canvas
   * click (stroke-cancel + place). Does not require the npc tool to be active.
   */
  placeNpcAtTile(x: number, y: number): void {
    if (!this.state) return;
    this.state = painter.placeNpcAtTile(this.state, { x, y });
    this.emitState();
    this.recomputeNpcOverlay();
  }

  setActiveTriggerOn(on: 'enter' | 'interact'): void {
    if (!this.state) return;
    this.state = painter.setActiveTriggerOn(this.state, on);
    this.emitState();
  }

  setActiveTriggerEventKey(key: string | undefined): void {
    if (!this.state) return;
    this.state = painter.setActiveTriggerEventKey(this.state, key);
    this.emitState();
  }

  /** Removes the trigger `id` from the active floor (c1a follow-up panel action). */
  removeTrigger(id: string): void {
    if (!this.state) return;
    this.state = painter.removeTrigger(this.state, id);
    this.emitState();
    this.recomputeTriggerOverlay();
  }

  /**
   * Panel "Place at tile" for triggers — same store path as a trigger-tool
   * canvas click (stroke-cancel + place). Does not require the trigger tool
   * to be active.
   */
  placeTriggerAtTile(x: number, y: number): void {
    if (!this.state) return;
    this.state = painter.placeTriggerAtTile(this.state, { x, y });
    this.emitState();
    this.recomputeTriggerOverlay();
  }

  // --- Lights (schema v6 WU-LIGHT-01; no overlay yet) ---

  setActiveLightKind(kind: LightDocument['kind']): void {
    if (!this.state) return;
    this.state = painter.setActiveLightKind(this.state, kind);
    this.emitState();
  }

  setActiveLightColor(color: string): void {
    if (!this.state) return;
    this.state = painter.setActiveLightColor(this.state, color);
    this.emitState();
  }

  setActiveLightIntensity(intensity: number): void {
    if (!this.state) return;
    this.state = painter.setActiveLightIntensity(this.state, intensity);
    this.emitState();
  }

  setActiveLightRange(range: number): void {
    if (!this.state) return;
    this.state = painter.setActiveLightRange(this.state, range);
    this.emitState();
  }

  setActiveLightHeight(height: number): void {
    if (!this.state) return;
    this.state = painter.setActiveLightHeight(this.state, height);
    this.emitState();
  }

  removeLight(id: string): void {
    if (!this.state) return;
    this.state = painter.removeLight(this.state, id);
    this.emitState();
    this.recomputeLightOverlay();
  }

  placeLightAtTile(x: number, y: number): void {
    if (!this.state) return;
    this.state = painter.placeLightAtTile(this.state, { x, y });
    this.emitState();
    this.recomputeLightOverlay();
  }

  /** Attach a light to player or an NPC id (no canvas marker; document-wide). */
  placeAttachedLight(attach: string): void {
    if (!this.state) return;
    this.state = painter.placeAttachedLightAction(this.state, attach);
    this.emitState();
  }

  undoLight(): void {
    if (!this.state) return;
    this.state = painter.undoLight(this.state).state;
    this.emitState();
    this.recomputeLightOverlay();
  }

  redoLight(): void {
    if (!this.state) return;
    this.state = painter.redoLight(this.state).state;
    this.emitState();
    this.recomputeLightOverlay();
  }

  // --- Event scripts + worldSeeds (events editor WU-02; no overlay recompute) ---

  addEvent(key: string): void {
    if (!this.state) return;
    this.state = painter.addEvent(this.state, key);
    this.emitState();
  }

  renameEvent(from: string, to: string): void {
    if (!this.state) return;
    this.state = painter.renameEvent(this.state, from, to);
    this.emitState();
  }

  removeEvent(key: string): void {
    if (!this.state) return;
    this.state = painter.removeEvent(this.state, key);
    this.emitState();
  }

  addCommand(eventKey: string, path: painter.CommandPath, kind: painter.EventCommandKind): void {
    if (!this.state) return;
    this.state = painter.addCommand(this.state, eventKey, path, kind);
    this.emitState();
  }

  updateCommand(
    eventKey: string,
    path: painter.CommandPath,
    patch: Readonly<Record<string, unknown>>,
  ): void {
    if (!this.state) return;
    this.state = painter.updateCommand(this.state, eventKey, path, patch);
    this.emitState();
  }

  removeCommand(eventKey: string, path: painter.CommandPath): void {
    if (!this.state) return;
    this.state = painter.removeCommand(this.state, eventKey, path);
    this.emitState();
  }

  moveCommand(eventKey: string, path: painter.CommandPath, delta: number): void {
    if (!this.state) return;
    this.state = painter.moveCommand(this.state, eventKey, path, delta);
    this.emitState();
  }

  setWorldSeed(key: string, value: WorldSeedValue): void {
    if (!this.state) return;
    this.state = painter.setWorldSeed(this.state, key, value);
    this.emitState();
  }

  removeWorldSeed(key: string): void {
    if (!this.state) return;
    this.state = painter.removeWorldSeed(this.state, key);
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

  /** Cancels any in-progress stroke without committing tiles (Escape chord, WU-UX-03) -- delegates to `painter-store.ts`'s `cancelStroke`. No-op while idle. */
  cancelStroke(): void {
    if (!this.state) return;
    const next = painter.cancelStroke(this.state);
    if (next === this.state) return;
    this.state = next;
    this.emitState();
  }

  /** The current map state (ALL floors' layers + semantics), for saving -- not just the active floor. `undefined` if no map is loaded. */
  currentDocument(): MapDocument | undefined {
    if (!this.doc || !this.state) return undefined;
    const composed = composeDocumentFromPainterFloors(
      this.doc,
      this.state.floors,
      this.state.rooms,
      this.state.stairLinks,
      this.state.spawn,
      this.state.props,
      this.state.npcs,
      this.state.triggers,
      this.state.events,
      this.state.worldSeeds,
      this.state.lights,
    );
    return {
      ...composed,
      tileset: { ...composed.tileset, semantics: this.state.semantics },
    };
  }

  /** Live map display name (document-level, not painter-store). */
  mapName(): string | undefined {
    return this.doc?.name;
  }

  /**
   * Sets document display name (WU-UX-09). Empty/whitespace normalizes to
   * Untitled Map. No-op when no map is loaded or the name is unchanged.
   */
  setMapName(name: string): void {
    if (!this.doc) return;
    const next = normalizeMapName(name);
    if (this.doc.name === next) return;
    this.doc = { ...this.doc, name: next };
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
    // Middle-button drag pans the camera (WU-UX-01); it never paints.
    if (event.button === 1) {
      if (!this.doc) return;
      event.preventDefault();
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.panState = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      return;
    }
    if (!this.state) return;
    const point = this.pickTile(event);
    if (!point) return;
    const options =
      this.state.tool === 'stair-link' ? { newStairLinkId: crypto.randomUUID() } : undefined;
    const result = painter.pointerDown(this.state, point, options);
    this.state = result.state;
    if (result.pickedTileId !== undefined) this.callbacks.onPicked?.(result.pickedTileId);
    if (this.state.tool === 'stair-link') this.recomputeStairOverlay();
    if (this.state.tool === 'spawn-point') this.recomputeSpawnOverlay();
    if (this.state.tool === 'prop') this.recomputePropOverlay();
    if (this.state.tool === 'npc') this.recomputeNpcOverlay();
    if (this.state.tool === 'trigger') this.recomputeTriggerOverlay();
    if (this.state.tool === 'light') this.recomputeLightOverlay();
    this.emitState();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.panState) {
      this.handlePanMove(event);
      return;
    }
    if (this.state?.stroke.status !== 'stroking') {
      // Not stroking: track the hovered tile for the highlight + status readout (WU-UX-04).
      this.updateHoverTile(this.pickTile(event));
      return;
    }
    const point = this.pickTile(event);
    if (!point) return;
    this.state = painter.pointerMove(this.state, point);
  }

  /** Applies one middle-drag increment: converts the pixel delta to a ground-plane target offset and re-fires the shared overlay recompute path (WU-UX-01). */
  private handlePanMove(event: PointerEvent): void {
    if (!this.panState || event.pointerId !== this.panState.pointerId) return;
    const dx = event.clientX - this.panState.lastX;
    const dy = event.clientY - this.panState.lastY;
    this.panState = { ...this.panState, lastX: event.clientX, lastY: event.clientY };
    if (dx === 0 && dy === 0) return;
    const next = panCameraTarget(
      { x: this.cameraTargetX, z: this.cameraTargetZ },
      dx,
      dy,
      this.cameraDistance,
      Math.max(this.container.clientHeight, 1),
      OVERVIEW_FOV_DEG,
      OVERVIEW_TILT_DEG,
    );
    this.cameraTargetX = next.x;
    this.cameraTargetZ = next.z;
    this.applyCameraPose();
    this.recomputeOverlays();
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.doc || this.referenceCameraDistance <= 0) return;
    // The wheel zooms the viewport, never scrolls the page (WU-UX-01).
    event.preventDefault();
    const next = zoomCameraDistance(this.cameraDistance, event.deltaY, {
      min: this.referenceCameraDistance * ZOOM_MIN_DISTANCE_FACTOR,
      max: this.referenceCameraDistance * ZOOM_MAX_DISTANCE_FACTOR,
    });
    if (next === this.cameraDistance) return;
    this.cameraDistance = next;
    this.applyCameraPose();
    this.recomputeOverlays();
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.panState && event.pointerId === this.panState.pointerId) {
      this.panState = undefined;
      return;
    }
    if (!this.state) return;
    const isRoomBoxCommit =
      this.state.stroke.status === 'stroking' && this.state.stroke.tool === 'room-box';
    const result = painter.pointerUp(
      this.state,
      isRoomBoxCommit ? { newRoomId: crypto.randomUUID() } : undefined,
    );
    this.state = result.state;
    if (result.diff) this.applyDiffLiveUpdate(result.diff);
    if (result.semanticTileIds) this.recomputeRampGlyphs();
    if (isRoomBoxCommit) this.recomputeRoomOverlay();
    this.emitState();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;
    const target = event.target as EditableTargetLike | null;
    const chord = resolveEditorChord(event);
    // Save resolves BEFORE the editable-target guard: Ctrl/Cmd+S works
    // everywhere, including while typing in the map-name field (WU-UX-03).
    if (chord === 'save') {
      event.preventDefault();
      this.callbacks.onSaveRequest?.();
      return;
    }
    // Empty modifiers = check ONLY for an editable target: undo/redo/cancel
    // stay native inside inputs (text undo, Escape-to-dismiss).
    const inEditableTarget = shouldIgnoreToolShortcut(target, {});
    if (chord !== null) {
      if (inEditableTarget) return;
      event.preventDefault();
      if (chord === 'undo') this.undo();
      else if (chord === 'redo') this.redo();
      else this.cancelStroke();
      return;
    }
    // Bare-letter tool shortcuts: suppressed while typing or chording (WU-UX-02).
    if (shouldIgnoreToolShortcut(target, event)) return;
    const tool = resolveToolShortcut(event.key);
    if (tool) this.setTool(tool);
  }

  /**
   * Composes `doc`'s floors and derives the ACTIVE floor's renderable
   * `RpgmMap`/`RpgmTileset` pair (see `map-compose.ts`) -- the shared
   * derivation both `rebuildActiveFloorScene` (full rebuild) and
   * `applyDiffLiveUpdate` (scoped live patch) need before calling
   * `buildChunks`.
   */
  private renderableSnapshot(doc: MapDocument, state: PainterState) {
    const composed = composeDocumentFromPainterFloors(doc, state.floors, state.rooms);
    const map = toRenderableMap(composed, state.activeFloor);
    const tileset = toRenderableTileset(composed);
    return { composed, map, tileset };
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
    const { map, tileset } = this.renderableSnapshot(this.doc, this.state);
    const chunks = buildChunks(
      map,
      tileset,
      this.sheetPixelSizes,
      DEFAULT_CHUNK_SIZE,
      undefined,
      undefined,
      this.doc.tileset.tilePixelSize,
    );

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
    const { map, tileset } = this.renderableSnapshot(this.doc, this.state);

    const dirtyKeys = computeDirtyChunkKeys(diff.cells, map, tileset, DEFAULT_CHUNK_SIZE);
    if (dirtyKeys.size === 0) return;

    const rebuilt = buildChunks(
      map,
      tileset,
      this.sheetPixelSizes,
      DEFAULT_CHUNK_SIZE,
      dirtyKeys,
      undefined,
      this.doc.tileset.tilePixelSize,
    );
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

  /** Frames the whole map from its center at the reference distance, RESETTING any wheel-zoom/drag-pan offsets (WU-UX-01) -- called once per `loadMap`. */
  private frameCamera(mapWidth: number, mapHeight: number): void {
    this.referenceCameraDistance = computeOverviewCameraDistance(
      mapWidth,
      mapHeight,
      OVERVIEW_DISTANCE_FACTOR,
      OVERVIEW_MAX_DISTANCE,
    );
    this.cameraDistance = this.referenceCameraDistance;
    this.cameraTargetX = (mapWidth * TILE_WORLD_SIZE) / 2;
    this.cameraTargetZ = (mapHeight * TILE_WORLD_SIZE) / 2;
    this.applyCameraPose();
  }

  /** Recomputes `this.cameraPose` from the current target/distance state through the SAME `computeOverviewCameraPose` path as initial framing, and syncs the live `THREE.Camera` -- the single write point for the camera (WU-UX-01). */
  private applyCameraPose(): void {
    const pose = computeOverviewCameraPose(
      this.cameraTargetX,
      this.cameraTargetZ,
      OVERVIEW_TILT_DEG,
      this.cameraDistance,
    );
    this.cameraPose = pose;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  }

  /**
   * Re-fires EVERY projected HTML overlay through the current camera pose --
   * the single shared recompute path for map load, floor changes, resize,
   * and every wheel-zoom/drag-pan camera change (WU-UX-01), so no overlay
   * can drift out of sync with the canvas.
   */
  private recomputeOverlays(): void {
    this.recomputeRampGlyphs();
    this.recomputeRoomOverlay();
    this.recomputeStairOverlay();
    this.recomputeSpawnOverlay();
    this.recomputePropOverlay();
    this.recomputeNpcOverlay();
    this.recomputeTriggerOverlay();
    this.recomputeLightOverlay();
    this.recomputeHoverOverlay();
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
    const composed = composeDocumentFromPainterFloors(
      this.doc,
      this.state.floors,
      this.state.rooms,
    );
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

  /**
   * Recomputes the active floor's authored room-box overlay (Slice 5b
   * design: "viewport overlay outlines rooms on the active floor") and
   * pushes it to `onRoomOverlayChange`. Each room rect's 4 tile-space
   * corners (`room-overlay.ts`'s `roomRectCorners`) are individually
   * projected via `projectToScreenFraction` and reduced to their enclosing
   * screen-space bounding box -- see `RoomOverlayItem`'s doc comment for why
   * that's an approximation, not an exact polygon.
   */
  private recomputeRoomOverlay(): void {
    if (!this.doc || !this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const rects = computeRoomOverlayRects(this.state.rooms, activeFloorId);

    const items: RoomOverlayItem[] = [];
    for (const entry of rects) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const corner of roomRectCorners(entry.rect)) {
        const projected = projectToScreenFraction(
          { x: corner.x, y: 0, z: corner.y },
          this.cameraPose,
          OVERVIEW_FOV_DEG,
          this.camera.aspect,
        );
        if (!projected) continue;
        xs.push(projected.xFrac);
        ys.push(projected.yFrac);
      }
      if (xs.length === 0) continue;
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      items.push({
        roomId: entry.roomId,
        ...(entry.roomName !== undefined ? { roomName: entry.roomName } : {}),
        leftFrac: left,
        topFrac: top,
        widthFrac: Math.max(...xs) - left,
        heightFrac: Math.max(...ys) - top,
      });
    }
    this.callbacks.onRoomOverlayChange?.(items);
  }

  /**
   * Recomputes the active floor's stair-link marker overlay (Slice 5b
   * design: entry/exit markers) and pushes it to `onStairOverlayChange`.
   * Each marker is a single tile-space point (unlike `recomputeRoomOverlay`'s
   * 4-corner bounding box), projected the same way `recomputeRampGlyphs`
   * projects a ramp glyph.
   */
  private recomputeStairOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const points = computeStairOverlayPoints(this.state.stairLinks, activeFloorId);

    const items: StairOverlayItem[] = [];
    for (const point of points) {
      const projected = projectToScreenFraction(
        { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      items.push({
        linkId: point.linkId,
        role: point.role,
        bidirectional: point.bidirectional,
        xFrac: projected.xFrac,
        yFrac: projected.yFrac,
      });
    }
    this.callbacks.onStairOverlayChange?.(items);
  }

  /**
   * Recomputes the active floor's spawn marker overlay (Slice 5b design:
   * "overlay glyph") and pushes it to `onSpawnOverlayChange` -- `undefined`
   * when unauthored or authored on a different floor (see
   * `spawn-overlay.ts`'s `computeSpawnOverlayPoint`).
   */
  private recomputeSpawnOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const point = computeSpawnOverlayPoint(this.state.spawn, activeFloorId);
    if (!point) {
      this.callbacks.onSpawnOverlayChange?.(undefined);
      return;
    }
    const projected = projectToScreenFraction(
      { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
      this.cameraPose,
      OVERVIEW_FOV_DEG,
      this.camera.aspect,
    );
    this.callbacks.onSpawnOverlayChange?.(
      projected ? { xFrac: projected.xFrac, yFrac: projected.yFrac } : undefined,
    );
  }

  /**
   * Recomputes the active floor's prop marker overlay (C5 WU-04) and pushes
   * it to `onPropOverlayChange` -- one point glyph per prop on the floor.
   */
  private recomputePropOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const points = computePropOverlayPoints(this.state.props, activeFloorId);

    const items: PropOverlayItem[] = [];
    for (const point of points) {
      const projected = projectToScreenFraction(
        { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      items.push({ id: point.id, xFrac: projected.xFrac, yFrac: projected.yFrac });
    }
    this.callbacks.onPropOverlayChange?.(items);
  }

  /** Recomputes the active floor's NPC marker overlay (c1a follow-up). */
  private recomputeNpcOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const points = computeNpcOverlayPoints(this.state.npcs, activeFloorId);

    const items: NpcOverlayItem[] = [];
    for (const point of points) {
      const projected = projectToScreenFraction(
        { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      items.push({ id: point.id, xFrac: projected.xFrac, yFrac: projected.yFrac });
    }
    this.callbacks.onNpcOverlayChange?.(items);
  }

  /** Recomputes the active floor's trigger marker overlay (c1a follow-up). */
  private recomputeTriggerOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const points = computeTriggerOverlayPoints(this.state.triggers, activeFloorId);

    const items: TriggerOverlayItem[] = [];
    for (const point of points) {
      const projected = projectToScreenFraction(
        { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      items.push({ id: point.id, xFrac: projected.xFrac, yFrac: projected.yFrac });
    }
    this.callbacks.onTriggerOverlayChange?.(items);
  }

  /** Recomputes the active floor's placed light markers (schema v6 WU-LIGHT-02). */
  private recomputeLightOverlay(): void {
    if (!this.state || !this.cameraPose) return;
    const activeFloorId = painter.activeFloorState(this.state).id;
    const points = computeLightOverlayPoints(this.state.lights, activeFloorId);

    const items: LightOverlayItem[] = [];
    for (const point of points) {
      const projected = projectToScreenFraction(
        { x: point.x + 0.5, y: 0, z: point.y + 0.5 },
        this.cameraPose,
        OVERVIEW_FOV_DEG,
        this.camera.aspect,
      );
      if (!projected) continue;
      items.push({
        id: point.id,
        xFrac: projected.xFrac,
        yFrac: projected.yFrac,
        kind: point.kind,
        color: point.color,
      });
    }
    this.callbacks.onLightOverlayChange?.(items);
  }

  /** Adopts `point` as the hovered tile if it changed (both-`undefined` counts as unchanged) and re-fires the hover overlay (WU-UX-04). */
  private updateHoverTile(point: TilePoint | undefined): void {
    if (this.hoverTile?.x === point?.x && this.hoverTile?.y === point?.y) return;
    this.hoverTile = point;
    this.recomputeHoverOverlay();
  }

  /** Projects the hovered tile (if any) through the current camera pose and pushes it to `onHoverChange` (WU-UX-04) -- part of `recomputeOverlays`, so the highlight follows zoom/pan/resize. */
  private recomputeHoverOverlay(): void {
    const onHoverChange = this.callbacks.onHoverChange;
    if (!onHoverChange) return;
    if (!this.hoverTile || !this.cameraPose) {
      onHoverChange(null);
      return;
    }
    const projected = projectToScreenFraction(
      { x: this.hoverTile.x + 0.5, y: 0, z: this.hoverTile.y + 0.5 },
      this.cameraPose,
      OVERVIEW_FOV_DEG,
      this.camera.aspect,
    );
    onHoverChange(
      projected
        ? {
            x: this.hoverTile.x,
            y: this.hoverTile.y,
            xFrac: projected.xFrac,
            yFrac: projected.yFrac,
          }
        : null,
    );
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
    this.recomputeOverlays();
  }

  dispose(): void {
    if (this.animationHandle !== undefined) cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.tilemap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
