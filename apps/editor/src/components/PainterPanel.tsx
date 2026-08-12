import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { LightDocument, MapDocument, NpcFacing, SemanticClass } from '@threemaker/map-format';
import type { SheetPixelSize } from '@threemaker/renderer';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AssetRow,
  type GameRow,
  getTileset,
  isTauriAvailable,
  listAssets,
  listGames,
  objectPreviewUrl,
} from '../catalog-client.js';
import {
  type CommunitySettings,
  type CommunityShareEnqueue,
  clearCommunityShareQueue,
  communityShareQueueLicenseCounts,
  communityShareQueueTileTotal,
  communityShareTileCount,
  describeCommunityShareStatus,
  formatCommunityShareAt,
  formatCommunityShareMapId,
  licenseTagFromSlots,
  loadCommunitySettings,
  loadCommunityShareQueue,
  maybeEnqueueCommunityShare,
  parseCommunityShareQueueJson,
  pushCommunityShareQueue,
  removeCommunityShareQueueJob,
  replaceCommunityShareQueue,
  saveCommunitySettings,
  serializeCommunityShareQueue,
  usesOnlyImportedSlotSources,
} from '../community-settings.js';
import {
  attachedLights,
  lightAttachTargets,
  lightPlacementFromDocument,
  lightsOnFloor,
  npcPlacementFromDocument,
  npcsOnFloor,
  pickMainRoomId,
  propObjectLibrary,
  propPlacementFromDocument,
  propsOnFloor,
  roomsOnFloor,
  triggerPlacementFromDocument,
  triggersOnFloor,
} from '../entity-lists.js';
import {
  canSavePainterDocument,
  defaultWorldSeedValue,
  parseWorldValue,
  type WorldValueKind,
  worldValueKind,
} from '../event-form-helpers.js';
import { formatTemplate } from '../format-template.js';
import { GlbIngestError, type GlbIngestFs, ingestGlbBytes } from '../glb-ingest.js';
import {
  INSPECTOR_TAB_IDS,
  type InspectorTabId,
  inspectorTabForTool,
} from '../inspector-routing.js';
import { loadMapDocument, saveMapDocument } from '../map-client.js';
import { composeMapFromTilesets, normalizeMapName, seedDemoTiles } from '../map-compose.js';
import { isEventReferenced, type PainterState, validateEventsDraft } from '../painter-store.js';
import type {
  HoverOverlayItem,
  LightOverlayItem,
  NpcOverlayItem,
  PropOverlayItem,
  RampGlyphOverlayItem,
  RoomOverlayItem,
  SpawnOverlayItem,
  StairOverlayItem,
  TriggerOverlayItem,
} from '../painter-viewport.js';
import { loadSlotTextures, PainterViewport } from '../painter-viewport.js';
import { applyDungeonStampToMapDocument } from '../procgen/apply-stamp.js';
import { stampSimpleDungeon } from '../procgen/dungeon-stamp.js';
import {
  assignmentFromPaletteClick,
  PROCGEN_PALETTE_ROLES,
  type ProcgenPaletteRole,
  selectedTileIdForRole,
  statusForPaletteAssignment,
} from '../procgen/palette-role.js';
import {
  DEFAULT_PROCGEN_PRESET,
  getProcgenPreset,
  PROCGEN_PRESETS,
  type ProcgenPresetId,
  stampRoomLightOptionsFromPreset,
} from '../procgen/presets.js';
import {
  clampFurnitureDensity,
  DEFAULT_FURNITURE_DENSITY,
  furnitureDensityFromPercent,
  furnitureDensityToPercent,
  nextProcgenSeed,
  pushProcgenSeedHistory,
  randomProcgenSeed,
} from '../procgen/seed.js';
import { countStampStairLinks } from '../procgen/stairs-from-stamp.js';
import { resolveDungeonTileIds } from '../procgen/tile-pick.js';
import { RAMP_DIRECTION_ARROW } from '../ramp-glyph.js';
import type { ToolId } from '../tool-sm.js';
import { CommandList } from './CommandForm.js';
import { GameTilesetPicker } from './GameTilesetPicker.js';
import { InkPanel } from './InkPanel.js';
import { TilePalette } from './TilePalette.js';

export interface PainterPanelProps {
  readonly t: (key: string) => string;
}

const TOOLS: readonly { readonly id: ToolId; readonly shortcut: string }[] = [
  { id: 'brush', shortcut: 'B' },
  { id: 'box-fill', shortcut: 'U' },
  { id: 'flood-fill', shortcut: 'G' },
  { id: 'eyedropper', shortcut: 'I' },
  { id: 'room-box', shortcut: 'R' },
  { id: 'stair-link', shortcut: 'S' },
  { id: 'spawn-point', shortcut: 'P' },
  { id: 'prop', shortcut: 'O' },
  { id: 'npc', shortcut: 'N' },
  { id: 'trigger', shortcut: 'T' },
  { id: 'light', shortcut: 'L' },
];

const LIGHT_KINDS: readonly LightDocument['kind'][] = ['point', 'spot'];

/** Paint layer roles for 2.5D authoring (schema indices 0–3, RPG Maker–style). */
const PAINT_LAYERS = [
  { index: 0 as const, nameKey: 'painter.layer.ground' },
  { index: 1 as const, nameKey: 'painter.layer.mid' },
  { index: 2 as const, nameKey: 'painter.layer.wall' },
  { index: 3 as const, nameKey: 'painter.layer.over' },
] as const;

const NPC_FACINGS: readonly NpcFacing[] = ['down', 'left', 'right', 'up'];

/** Short form for content-addressed object display (first 8 hex chars). */
function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Builds injectable `ingestGlbBytes` deps against the real Tauri asset-store
 * path. Paths are absolute (from `catalog_asset_store_dir`); capability grants
 * cover `$HOME/.threemaker/asset-store/objects/**` for write/mkdir/rename/exists.
 */
async function buildTauriGlbIngestDeps(): Promise<{ storeRoot: string; fs: GlbIngestFs }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { exists, mkdir, rename, writeFile } = await import('@tauri-apps/plugin-fs');
  const storeRoot = await invoke<string>('catalog_asset_store_dir');
  return {
    storeRoot,
    fs: {
      exists: (path) => exists(path),
      mkdir: (path, options) => mkdir(path, options),
      writeFile: (path, data) => writeFile(path, data),
      rename: (from, to) => rename(from, to),
    },
  };
}

const SEMANTIC_CLASSES: readonly SemanticClass[] = [
  'none',
  'wall',
  'door',
  'window',
  'furniture',
  'ramp',
];

const DEMO_MAP_WIDTH = 20;
const DEMO_MAP_HEIGHT = 15;
/** First A2 autotile id (kind 0, shape 0) -- a valid, always-populated ground tile for any properly-formed A2 sheet. */
const GROUND_TILE_ID = 2816;
/** B-sheet local index 1 (id 0 on the B sheet is treated as "empty" everywhere in this codebase, so the demo seed uses id 1 instead). */
const DECOR_TILE_ID = 1;

interface PaletteSlotInfo {
  readonly slot: TileSheetId;
  readonly imageUrl: string;
  readonly pixelSize: SheetPixelSize;
  readonly tilePixelSize: number;
}

/**
 * Resolves a preview URL + real pixel size for every composed slot that
 * has a resolved object hash and a loaded texture, for the visual tile
 * palette (`TilePalette`). Shared by `handleCreateMap`/`handleLoad` so the
 * palette-building logic isn't duplicated across both entry points.
 */
async function buildPaletteSlots(
  doc: MapDocument,
  sheetPixelSizes: Partial<Record<TileSheetId, SheetPixelSize>>,
): Promise<readonly PaletteSlotInfo[]> {
  const entries = Object.entries(doc.tileset.slots) as [
    TileSheetId,
    { object: string } | undefined,
  ][];
  const slots: PaletteSlotInfo[] = [];
  for (const [slot, source] of entries) {
    if (!source?.object) continue;
    const pixelSize = sheetPixelSizes[slot];
    if (!pixelSize) continue;
    const imageUrl = await objectPreviewUrl(source.object, 'png');
    slots.push({
      slot,
      imageUrl,
      pixelSize,
      tilePixelSize: doc.tileset.tilePixelSize,
    });
  }
  return slots;
}

/** Resolves a floor id to its display label (`label` if authored, otherwise `painter.floorOption` formatted with its stack index) -- shared by the stair-link list and the spawn indicator, since both reference floors by stable id rather than index. Falls back to the raw id for a dangling reference (should not happen in practice; `composeDocumentFromPainterFloors` drops those on save). */
function resolveFloorLabel(
  floors: PainterState['floors'],
  id: string,
  t: (key: string) => string,
): string {
  const index = floors.findIndex((floor) => floor.id === id);
  if (index === -1) return id;
  const floor = floors[index];
  return floor?.label ?? formatTemplate(t('painter.floorOption'), { index });
}

/**
 * Painter: compose a map from two different games' tilesets (one slot
 * each), then paint it with brush/box-fill/flood-fill/eyedropper, undo/
 * redo, and semantic-class mode. All catalog IO goes through
 * `catalog-client.ts`; all painting logic goes through
 * `painter-viewport.ts` (imperative, untested) -> `painter-store.ts` (pure,
 * tested). This component owns only UI/selection state, left untested per
 * this repo's convention.
 */
export function PainterPanel({ t }: PainterPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PainterViewport | null>(null);

  const [games, setGames] = useState<readonly GameRow[]>([]);
  const [gameAId, setGameAId] = useState<number | undefined>(undefined);
  const [gameBId, setGameBId] = useState<number | undefined>(undefined);
  const [tilesetAId, setTilesetAId] = useState<number | undefined>(undefined);
  const [tilesetBId, setTilesetBId] = useState<number | undefined>(undefined);

  const [mapReady, setMapReady] = useState(false);
  /** Document display name draft (WU-UX-09); committed on blur via setMapName. */
  const [mapNameDraft, setMapNameDraft] = useState('');
  const [painterState, setPainterState] = useState<PainterState | undefined>(undefined);
  const [paletteSlots, setPaletteSlots] = useState<readonly PaletteSlotInfo[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [rampGlyphs, setRampGlyphs] = useState<readonly RampGlyphOverlayItem[]>([]);
  const [roomOverlay, setRoomOverlay] = useState<readonly RoomOverlayItem[]>([]);
  const [stairOverlay, setStairOverlay] = useState<readonly StairOverlayItem[]>([]);
  const [spawnOverlay, setSpawnOverlay] = useState<SpawnOverlayItem | undefined>(undefined);
  const [propOverlay, setPropOverlay] = useState<readonly PropOverlayItem[]>([]);
  const [npcOverlay, setNpcOverlay] = useState<readonly NpcOverlayItem[]>([]);
  const [triggerOverlay, setTriggerOverlay] = useState<readonly TriggerOverlayItem[]>([]);
  const [lightOverlay, setLightOverlay] = useState<readonly LightOverlayItem[]>([]);
  /** Hovered tile highlight + status readout (WU-UX-04); null off-map. */
  const [hoverOverlay, setHoverOverlay] = useState<HoverOverlayItem | null>(null);
  /** Live Save handler for the viewport's Ctrl/Cmd+S chord (WU-UX-03) -- a ref because the viewport (and its callbacks object) mounts once while handleSave re-binds with settings. */
  const saveRequestRef = useRef<() => void>(() => {});
  const [characterSprites, setCharacterSprites] = useState<readonly AssetRow[]>([]);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  // Coordinate placement (complements canvas clicks on large maps).
  const [propPlaceX, setPropPlaceX] = useState(0);
  const [propPlaceY, setPropPlaceY] = useState(0);
  const [npcPlaceX, setNpcPlaceX] = useState(0);
  const [npcPlaceY, setNpcPlaceY] = useState(0);
  const [triggerPlaceX, setTriggerPlaceX] = useState(0);
  const [triggerPlaceY, setTriggerPlaceY] = useState(0);
  const [lightPlaceX, setLightPlaceX] = useState(0);
  const [lightPlaceY, setLightPlaceY] = useState(0);
  /** Attach target for attached lights (`player` or npc id). */
  const [lightAttachTarget, setLightAttachTarget] = useState('player');
  // Events section UI (events editor WU-02).
  const [selectedEventKey, setSelectedEventKey] = useState<string | undefined>(undefined);
  const [newEventKey, setNewEventKey] = useState('');
  const [newWorldSeedKey, setNewWorldSeedKey] = useState('');
  const [newWorldSeedKind, setNewWorldSeedKind] = useState<WorldValueKind>('boolean');
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('paint');
  const [community, setCommunity] = useState<CommunitySettings>(() => loadCommunitySettings());
  const [communityQueue, setCommunityQueue] = useState<readonly CommunityShareEnqueue[]>(() =>
    loadCommunityShareQueue(),
  );
  /** Procgen seed (uint32). Editable; randomize button rolls a new one. */
  const [procgenSeed, setProcgenSeed] = useState(() => (Date.now() >>> 0) % 1_000_000_000);
  /** Newest-first seeds that produced a stamp (replay via click). */
  const [procgenSeedHistory, setProcgenSeedHistory] = useState<readonly number[]>([]);
  const [procgenPreset, setProcgenPreset] = useState<ProcgenPresetId>(DEFAULT_PROCGEN_PRESET);
  /** 0 = auto (layer majority / fallback); else explicit wall tile id. */
  const [procgenWallTileId, setProcgenWallTileId] = useState(0);
  /** 0 = auto (door-class semantics); else explicit mid-layer door tile id. */
  const [procgenDoorTileId, setProcgenDoorTileId] = useState(0);
  /** 0 = auto (furniture-class semantics); else explicit mid-layer furniture tile id. */
  const [procgenFurnitureTileId, setProcgenFurnitureTileId] = useState(0);
  /** Sparse furniture density 0–1 (mid layer); 0 disables scatter. */
  const [procgenFurnitureDensity, setProcgenFurnitureDensity] = useState(DEFAULT_FURNITURE_DENSITY);
  /** Palette dock: click assigns brush fill, wall override, or door override. */
  const [paletteRole, setPaletteRole] = useState<ProcgenPaletteRole>('brush');

  const communityStatus = useMemo(
    () => describeCommunityShareStatus(community, communityQueue),
    [community, communityQueue],
  );

  const activeFloorId = painterState?.floors[painterState.activeFloor]?.id;
  const floorRooms = useMemo(
    () => roomsOnFloor(painterState?.rooms ?? [], activeFloorId),
    [painterState?.rooms, activeFloorId],
  );
  const floorProps = useMemo(
    () => propsOnFloor(painterState?.props ?? [], activeFloorId),
    [painterState?.props, activeFloorId],
  );
  const floorNpcs = useMemo(
    () => npcsOnFloor(painterState?.npcs ?? [], activeFloorId),
    [painterState?.npcs, activeFloorId],
  );
  const floorTriggers = useMemo(
    () => triggersOnFloor(painterState?.triggers ?? [], activeFloorId),
    [painterState?.triggers, activeFloorId],
  );
  const floorLights = useMemo(
    () => lightsOnFloor(painterState?.lights ?? [], activeFloorId),
    [painterState?.lights, activeFloorId],
  );
  const docAttachedLights = useMemo(
    () => attachedLights(painterState?.lights ?? []),
    [painterState?.lights],
  );
  const attachTargets = useMemo(
    () => lightAttachTargets(painterState?.npcs ?? []),
    [painterState?.npcs],
  );
  const objectLibrary = useMemo(
    () => propObjectLibrary(painterState?.props ?? [], painterState?.activePropObject),
    [painterState?.props, painterState?.activePropObject],
  );

  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((err) => console.error('Failed to load games for the painter:', err));
  }, []);

  useEffect(() => {
    // Character sheets already live in the catalog/asset-store from imports
    // (unlike props, which use the glb-ingest path). First page is enough for
    // a minimal sprite picker; the full catalog browser covers the rest.
    listAssets({ type: 'character' }, 0)
      .then((page) => setCharacterSprites(page.rows))
      .catch((err) => console.error('Failed to load character sprites for the painter:', err));
  }, []);

  // Mirror event-key load defaults: when the character catalog arrives and no
  // sprite is selected yet, pick the first sheet so NPC placement is not a
  // silent no-op (trigger only needs the defaulted event key; NPC also needs
  // a sprite). handleLoad/handleCreateMap also call this after loadMap.
  useEffect(() => {
    if (!mapReady || characterSprites.length === 0) return;
    const current = viewportRef.current?.painterState;
    if (!current || current.activeNpcSpriteObject) return;
    const first = characterSprites[0]?.sha256;
    if (first) viewportRef.current?.setActiveNpcSpriteObject(first);
  }, [mapReady, characterSprites]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = new PainterViewport(container, {
      onStateChange: setPainterState,
      onPicked: (tileId) => viewport.setFillTileId(tileId),
      onRampGlyphsChange: setRampGlyphs,
      onRoomOverlayChange: setRoomOverlay,
      onStairOverlayChange: setStairOverlay,
      onSpawnOverlayChange: setSpawnOverlay,
      onPropOverlayChange: setPropOverlay,
      onNpcOverlayChange: setNpcOverlay,
      onTriggerOverlayChange: setTriggerOverlay,
      onLightOverlayChange: setLightOverlay,
      onHoverChange: setHoverOverlay,
      onSaveRequest: () => saveRequestRef.current(),
    });
    viewportRef.current = viewport;
    return () => {
      viewport.dispose();
      viewportRef.current = null;
    };
  }, []);

  const handleGlbFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Allow re-selecting the same file later.
      event.target.value = '';
      if (!file) return;
      setStatusMessage(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isTauriAvailable()) {
          setStatusMessage(t('painter.props.ingestNeedsTauri'));
          return;
        }
        const deps = await buildTauriGlbIngestDeps();
        const result = await ingestGlbBytes(bytes, deps);
        viewportRef.current?.setActivePropObject(result.sha256);
        setStatusMessage(
          formatTemplate(t('painter.props.ingestSuccess'), { sha: shortSha(result.sha256) }),
        );
      } catch (err) {
        console.error('Failed to ingest .glb:', err);
        const message =
          err instanceof GlbIngestError ? err.message : t('painter.props.ingestFailed');
        setStatusMessage(message);
      }
    },
    [t],
  );

  const handleCreateMap = useCallback(async () => {
    if (tilesetAId === undefined || tilesetBId === undefined) return;
    setStatusMessage(null);
    try {
      const [tilesetA, tilesetB] = await Promise.all([
        getTileset(tilesetAId),
        getTileset(tilesetBId),
      ]);
      if (!tilesetA || !tilesetB) {
        setStatusMessage(t('painter.createFailed'));
        return;
      }
      const doc = seedDemoTiles(
        composeMapFromTilesets({
          id: crypto.randomUUID(),
          name: 'Demo Map',
          width: DEMO_MAP_WIDTH,
          height: DEMO_MAP_HEIGHT,
          sources: [
            { slot: 'A2', tileset: tilesetA },
            { slot: 'B', tileset: tilesetB },
          ],
        }),
        GROUND_TILE_ID,
        DECOR_TILE_ID,
      );
      const { textures, sheetPixelSizes } = await loadSlotTextures(doc);
      viewportRef.current?.loadMap(doc, textures, sheetPixelSizes, GROUND_TILE_ID);
      // loadMap resets session selection; re-default the first catalog sprite
      // so NPC place is available immediately (same role as eventKeys[0]).
      const firstSprite = characterSprites[0]?.sha256;
      if (firstSprite) viewportRef.current?.setActiveNpcSpriteObject(firstSprite);
      setPaletteSlots(await buildPaletteSlots(doc, sheetPixelSizes));
      setMapNameDraft(doc.name);
      setMapReady(true);
    } catch (err) {
      console.error('Failed to create the painter demo map:', err);
      setStatusMessage(t('painter.createFailed'));
    }
  }, [tilesetAId, tilesetBId, t, characterSprites]);

  const handleSave = useCallback(async () => {
    const liveState = viewportRef.current?.painterState;
    if (liveState) {
      const block = canSavePainterDocument(liveState);
      if (block !== null) {
        setStatusMessage(block);
        return;
      }
    }
    const doc = viewportRef.current?.currentDocument();
    if (!doc) return;
    try {
      await saveMapDocument(doc);
      // Community share is opt-out (default on); no network in v0 — enqueue only.
      const tileShas = Object.values(doc.tileset.slots)
        .map((slot) => slot?.object)
        .filter((sha): sha is string => typeof sha === 'string' && sha.length > 0);
      const licenseTag = licenseTagFromSlots(doc.tileset.slots);
      const onlyImported = usesOnlyImportedSlotSources(doc.tileset.slots);
      const enqueue = maybeEnqueueCommunityShare(community, {
        mapId: doc.id,
        mapName: doc.name,
        tileObjectShas: tileShas,
        usesOnlyImportedAssets: onlyImported,
        version: doc.version,
        licenseTag,
      });
      if (enqueue) {
        console.info('[Maker Studio] community share queued (offline stub)', enqueue);
        setCommunityQueue(pushCommunityShareQueue(enqueue));
        setStatusMessage(t('painter.saveSuccessShareQueued'));
      } else if (community.shareOnSave && onlyImported && !community.allowImportedAssets) {
        setStatusMessage(t('painter.saveSuccessShareBlockedImported'));
      } else {
        setStatusMessage(t('painter.saveSuccess'));
      }
    } catch (err) {
      console.error('Failed to save the map:', err);
      setStatusMessage(t('painter.saveFailed'));
    }
  }, [t, community]);

  // Keep the viewport's Ctrl/Cmd+S chord pointing at the CURRENT Save handler.
  useEffect(() => {
    saveRequestRef.current = () => {
      void handleSave();
    };
  }, [handleSave]);

  const handleGenerateDungeon = useCallback(async () => {
    const viewport = viewportRef.current;
    const doc = viewport?.currentDocument();
    const state = viewport?.painterState;
    if (!viewport || !doc || !state) {
      setStatusMessage(t('painter.procgen.needMap'));
      return;
    }
    try {
      // Stamp the active floor so multi-floor maps can Generate upper levels.
      const targetFloorIndex = Math.min(
        Math.max(0, state.activeFloor),
        Math.max(0, doc.floors.length - 1),
      );
      const targetFloor = doc.floors[targetFloorIndex];
      const groundLayer = targetFloor?.layers.tiles[0] ?? [];
      const midLayer = targetFloor?.layers.tiles[1] ?? [];
      const wallLayer = targetFloor?.layers.tiles[2] ?? [];
      const { groundTileId, wallTileId, doorTileId, furnitureTileId } = resolveDungeonTileIds({
        fillTileId: state.fillTileId,
        groundLayer,
        wallLayer,
        midLayer,
        fallbackGround: GROUND_TILE_ID,
        // A4 wall range start — only used when the map has no wall majority yet.
        fallbackWall: 4352,
        semantics: state.semantics,
        ...(procgenWallTileId > 0 ? { wallTileOverride: procgenWallTileId } : {}),
        ...(procgenDoorTileId > 0 ? { doorTileOverride: procgenDoorTileId } : {}),
        ...(procgenFurnitureTileId > 0 ? { furnitureTileOverride: procgenFurnitureTileId } : {}),
      });
      const seed = procgenSeed >>> 0;
      const preset = getProcgenPreset(procgenPreset);
      const stamp = stampSimpleDungeon({
        width: doc.width,
        height: doc.height,
        seed,
        groundTileId,
        wallTileId,
        ...(doorTileId !== undefined ? { doorTileId } : {}),
        ...(furnitureTileId !== undefined
          ? {
              furnitureTileId,
              furnitureDensity: clampFurnitureDensity(procgenFurnitureDensity),
            }
          : {}),
        roomCount: preset.roomCount,
        minRoomSize: preset.minRoomSize,
        maxRoomSize: preset.maxRoomSize,
        corridorWidth: preset.corridorWidth,
        tightBorder: preset.tightBorder,
      });
      // Stamp rewrites the active floor's tile layers + rooms; other floors + narrative stay.
      // Spawn + room lamps + player torch so Generate is immediately playable/lit.
      const stamped = applyDungeonStampToMapDocument(doc, stamp, {
        targetFloorIndex,
        placeSpawnInMainRoom: true,
        replaceFloor0Rooms: true,
        placeRoomLights: true,
        roomLightOptions: stampRoomLightOptionsFromPreset(preset),
        placePlayerTorch: true,
        // Multi-floor maps get a stair to the adjacent floor (prefer below).
        placeStairToAdjacentFloor: doc.floors.length > 1,
      });
      const { textures, sheetPixelSizes } = await loadSlotTextures(stamped);
      viewport.loadMap(stamped, textures, sheetPixelSizes, groundTileId);
      setPaletteSlots(await buildPaletteSlots(stamped, sheetPixelSizes));
      setMapNameDraft(stamped.name);
      setMapReady(true);
      // Surface rooms list + highlight main chamber (matches spawn placement).
      setInspectorTab('map');
      viewport.selectFloor(targetFloorIndex);
      const stampedFloorId = stamped.floors[targetFloorIndex]?.id;
      const mainRoomId = pickMainRoomId(roomsOnFloor(stamped.rooms, stampedFloorId));
      viewport.setActiveRoomId(mainRoomId);
      // Remember used seed for replay; bump so the next Generate is new without Rnd.
      setProcgenSeedHistory((prev) => pushProcgenSeedHistory(prev, seed));
      setProcgenSeed(nextProcgenSeed(seed));
      setStatusMessage(
        formatTemplate(t('painter.procgen.success'), {
          rooms: stamp.rooms.length,
          doors: stamp.doors.length,
          furniture: stamp.furnitureCount,
          lights: stamped.lights.filter((l) => l.floor === stampedFloorId).length,
          stairs: countStampStairLinks(stamped.stairLinks),
          seed: stamp.seed,
          preset: t(`painter.procgen.preset.${preset.id}`),
        }),
      );
    } catch (err) {
      console.error('Dungeon procgen failed:', err);
      setStatusMessage(t('painter.procgen.failed'));
    }
  }, [
    t,
    procgenSeed,
    procgenPreset,
    procgenWallTileId,
    procgenDoorTileId,
    procgenFurnitureTileId,
    procgenFurnitureDensity,
  ]);

  // Keep selected event key in sync with the live eventKeys list.
  useEffect(() => {
    if (!painterState) {
      setSelectedEventKey(undefined);
      return;
    }
    if (selectedEventKey !== undefined && painterState.eventKeys.includes(selectedEventKey)) {
      return;
    }
    setSelectedEventKey(painterState.eventKeys[0]);
  }, [painterState, selectedEventKey]);

  const eventsValidationError = useMemo(
    () => (painterState ? validateEventsDraft(painterState.events) : null),
    [painterState],
  );

  // Route inspector to the pane that matches the active tool (Unity-style).
  const activeTool = painterState?.tool;
  useEffect(() => {
    if (activeTool === undefined) return;
    setInspectorTab(inspectorTabForTool(activeTool));
  }, [activeTool]);

  const handleLoad = useCallback(async () => {
    try {
      const doc = await loadMapDocument();
      if (!doc) {
        setStatusMessage(t('painter.loadEmpty'));
        return;
      }
      const { textures, sheetPixelSizes } = await loadSlotTextures(doc);
      viewportRef.current?.loadMap(doc, textures, sheetPixelSizes, GROUND_TILE_ID);
      const firstSprite = characterSprites[0]?.sha256;
      if (firstSprite) viewportRef.current?.setActiveNpcSpriteObject(firstSprite);
      setPaletteSlots(await buildPaletteSlots(doc, sheetPixelSizes));
      setMapNameDraft(doc.name);
      setMapReady(true);
      setStatusMessage(t('painter.loadSuccess'));
    } catch (err) {
      console.error('Failed to load the map:', err);
      setStatusMessage(t('painter.loadFailed'));
    }
  }, [t, characterSprites]);

  const TOOL_GLYPHS: Readonly<Record<ToolId, string>> = {
    brush: 'B',
    'box-fill': 'U',
    'flood-fill': 'G',
    eyedropper: 'I',
    'room-box': 'R',
    'stair-link': 'S',
    'spawn-point': 'P',
    prop: 'O',
    npc: 'N',
    trigger: 'T',
    light: 'L',
  };

  const INSPECTOR_TABS = INSPECTOR_TAB_IDS;

  return (
    <div className="ide-workspace">
      <div className="ide-menubar">
        <div className="ide-menubar-group">
          {mapReady && (
            <button type="button" className="primary" onClick={handleSave}>
              {t('painter.save')}
            </button>
          )}
          <button type="button" onClick={handleLoad}>
            {t('painter.load')}
          </button>
          {mapReady && (
            <>
              <button type="button" onClick={() => viewportRef.current?.undo()}>
                {t('painter.undo')}
              </button>
              <button type="button" onClick={() => viewportRef.current?.redo()}>
                {t('painter.redo')}
              </button>
              <label className="ide-menubar-seed">
                {t('painter.procgen.preset')}
                <select
                  value={procgenPreset}
                  onChange={(event) => setProcgenPreset(event.target.value as ProcgenPresetId)}
                >
                  {PROCGEN_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(`painter.procgen.preset.${p.id}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ide-menubar-seed">
                {t('painter.procgen.seed')}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={procgenSeed}
                  onChange={(event) => {
                    const n = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(n)) setProcgenSeed(n >>> 0);
                  }}
                />
              </label>
              <button
                type="button"
                title={t('painter.procgen.randomizeSeed')}
                onClick={() => setProcgenSeed(randomProcgenSeed())}
              >
                {t('painter.procgen.randomizeSeedShort')}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleGenerateDungeon()}
              >
                {t('painter.procgen.generate')}
              </button>
            </>
          )}
        </div>
        {painterState && (
          <>
            <div className="ide-menubar-sep" aria-hidden />
            <div className="ide-menubar-group">
              <label title={t('painter.mapNameHint')}>
                {t('painter.mapName')}
                <input
                  type="text"
                  value={mapNameDraft}
                  onChange={(event) => setMapNameDraft(event.target.value)}
                  onBlur={() => {
                    const next = normalizeMapName(mapNameDraft);
                    setMapNameDraft(next);
                    viewportRef.current?.setMapName(next);
                  }}
                />
              </label>
            </div>
            <div className="ide-menubar-sep" aria-hidden />
            <div className="ide-menubar-group">
              <label>
                {t('painter.floors')}
                <select
                  value={painterState.activeFloor}
                  onChange={(event) => viewportRef.current?.selectFloor(Number(event.target.value))}
                >
                  {painterState.floors.map((floor, index) => (
                    <option key={floor.id} value={index}>
                      {floor.label ?? formatTemplate(t('painter.floorOption'), { index })}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => viewportRef.current?.addFloor(crypto.randomUUID())}
              >
                {t('painter.addFloor')}
              </button>
              <button
                type="button"
                disabled={painterState.floors.length <= 1}
                onClick={() => viewportRef.current?.removeFloor(painterState.activeFloor)}
              >
                {t('painter.removeFloor')}
              </button>
              <label title={t('painter.floorLabelHint')}>
                {t('painter.floorLabel')}
                <input
                  type="text"
                  value={painterState.floors[painterState.activeFloor]?.label ?? ''}
                  placeholder={formatTemplate(t('painter.floorOption'), {
                    index: painterState.activeFloor,
                  })}
                  onChange={(event) =>
                    viewportRef.current?.setFloorLabel(painterState.activeFloor, event.target.value)
                  }
                />
              </label>
            </div>
            <div className="ide-menubar-sep" aria-hidden />
            <div className="ide-menubar-group">
              <label>
                {t('painter.layer')}
                <select
                  value={painterState.activeLayer}
                  onChange={(event) =>
                    viewportRef.current?.setActiveLayer(Number(event.target.value) as 0 | 1 | 2 | 3)
                  }
                >
                  {PAINT_LAYERS.map((layer) => (
                    <option key={layer.index} value={layer.index}>
                      {layer.index}: {t(layer.nameKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ide-check">
                <input
                  type="checkbox"
                  checked={painterState.semanticMode}
                  onChange={(event) => viewportRef.current?.setSemanticMode(event.target.checked)}
                />
                {t('painter.semanticMode')}
              </label>
              {painterState.semanticMode && (
                <select
                  value={painterState.semanticClass}
                  onChange={(event) =>
                    viewportRef.current?.setSemanticClass(event.target.value as SemanticClass)
                  }
                >
                  {SEMANTIC_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {t(`painter.semanticClass.${cls}`)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}
      </div>

      <div className="ide-body">
        <aside className="ide-tool-rail" aria-label={t('painter.tools')}>
          {TOOLS.map((tool) => {
            const active = mapReady && painterState?.tool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                disabled={!mapReady}
                className={`ide-tool-btn${active ? ' ide-tool-btn-active' : ''}`}
                title={`${t(`painter.tool.${tool.id}`)} (${tool.shortcut})`}
                onClick={() => viewportRef.current?.setTool(tool.id)}
              >
                <span className="ide-tool-glyph">{TOOL_GLYPHS[tool.id]}</span>
                <span className="ide-tool-key">{tool.shortcut}</span>
              </button>
            );
          })}
        </aside>

        <div className="ide-center">
          <div className="ide-viewport-stage">
            {/* Always mounted so PainterViewport attaches once and survives mapReady toggles. */}
            <div ref={containerRef} className="painter-viewport-canvas" />

            {painterState && rampGlyphs.length > 0 && (
              <div
                className="painter-ramp-glyphs"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {rampGlyphs.map((glyph) => (
                  <span
                    key={`${glyph.x},${glyph.y}`}
                    className="painter-ramp-glyph"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${glyph.xFrac * 100}%`,
                      top: `${glyph.yFrac * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    aria-label={formatTemplate(t('painter.rampGlyphLabel'), {
                      direction: t(`painter.rampDirection.${glyph.direction}`),
                    })}
                  >
                    {RAMP_DIRECTION_ARROW[glyph.direction]}
                  </span>
                ))}
              </div>
            )}

            {painterState && roomOverlay.length > 0 && (
              <div
                className="painter-room-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {roomOverlay.map((room) => (
                  <div
                    key={`${room.roomId}-${room.leftFrac}-${room.topFrac}`}
                    className="painter-room-rect"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${room.leftFrac * 100}%`,
                      top: `${room.topFrac * 100}%`,
                      width: `${room.widthFrac * 100}%`,
                      height: `${room.heightFrac * 100}%`,
                      border: '2px solid #4fc3f7',
                      boxSizing: 'border-box',
                    }}
                    aria-label={formatTemplate(t('painter.room.overlayLabel'), {
                      name: room.roomName ?? room.roomId,
                    })}
                  />
                ))}
              </div>
            )}

            {painterState && stairOverlay.length > 0 && (
              <div
                className="painter-stair-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {stairOverlay.map((point) => {
                  const link = painterState.stairLinks.find((entry) => entry.id === point.linkId);
                  const counterpartFloor = point.role === 'entry' ? link?.toFloor : link?.fromFloor;
                  const label = formatTemplate(
                    t(
                      point.role === 'entry'
                        ? 'painter.stairLink.entryLabel'
                        : 'painter.stairLink.exitLabel',
                    ),
                    {
                      floor: counterpartFloor
                        ? resolveFloorLabel(painterState.floors, counterpartFloor, t)
                        : '',
                    },
                  );
                  return (
                    <span
                      key={`${point.linkId}-${point.role}`}
                      className={`painter-stair-marker painter-stair-marker-${point.role}`}
                      role="img"
                      style={{
                        position: 'absolute',
                        left: `${point.xFrac * 100}%`,
                        top: `${point.yFrac * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      aria-label={label}
                    >
                      {point.role === 'entry' ? '▲' : '▼'}
                    </span>
                  );
                })}
              </div>
            )}

            {painterState && spawnOverlay && (
              <div
                className="painter-spawn-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <span
                  className="painter-spawn-marker"
                  role="img"
                  style={{
                    position: 'absolute',
                    left: `${spawnOverlay.xFrac * 100}%`,
                    top: `${spawnOverlay.yFrac * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-label={t('painter.spawn.overlayLabel')}
                >
                  ★
                </span>
              </div>
            )}

            {painterState && propOverlay.length > 0 && (
              <div
                className="painter-prop-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {propOverlay.map((point) => (
                  <span
                    key={point.id}
                    className="painter-prop-marker"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${point.xFrac * 100}%`,
                      top: `${point.yFrac * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    aria-label={formatTemplate(t('painter.props.overlayLabel'), {
                      id: point.id,
                    })}
                  >
                    ◆
                  </span>
                ))}
              </div>
            )}

            {painterState && npcOverlay.length > 0 && (
              <div
                className="painter-npc-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {npcOverlay.map((point) => (
                  <span
                    key={point.id}
                    className="painter-npc-marker"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${point.xFrac * 100}%`,
                      top: `${point.yFrac * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      color: '#81c784',
                    }}
                    aria-label={formatTemplate(t('painter.npcs.overlayLabel'), {
                      id: point.id,
                    })}
                  >
                    ☺
                  </span>
                ))}
              </div>
            )}

            {painterState && triggerOverlay.length > 0 && (
              <div
                className="painter-trigger-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {triggerOverlay.map((point) => (
                  <span
                    key={point.id}
                    className="painter-trigger-marker"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${point.xFrac * 100}%`,
                      top: `${point.yFrac * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      color: '#ffb74d',
                    }}
                    aria-label={formatTemplate(t('painter.triggers.overlayLabel'), {
                      id: point.id,
                    })}
                  >
                    ◎
                  </span>
                ))}
              </div>
            )}

            {painterState && lightOverlay.length > 0 && (
              <div
                className="painter-light-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {lightOverlay.map((point) => (
                  <span
                    key={point.id}
                    className="painter-light-marker"
                    role="img"
                    style={{
                      position: 'absolute',
                      left: `${point.xFrac * 100}%`,
                      top: `${point.yFrac * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      color: point.color,
                    }}
                    aria-label={formatTemplate(t('painter.lights.overlayLabel'), {
                      id: point.id,
                      kind: point.kind,
                    })}
                  >
                    {point.kind === 'spot' ? '◉' : '☀'}
                  </span>
                ))}
              </div>
            )}

            {painterState && hoverOverlay && (
              <div
                className="painter-hover-overlay"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <span
                  className="painter-hover-marker"
                  role="img"
                  style={{
                    position: 'absolute',
                    left: `${hoverOverlay.xFrac * 100}%`,
                    top: `${hoverOverlay.yFrac * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-label={formatTemplate(t('painter.status.hover'), {
                    x: hoverOverlay.x,
                    y: hoverOverlay.y,
                  })}
                >
                  ▣
                </span>
              </div>
            )}

            {(!mapReady || !painterState) && (
              <div className="ide-welcome" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
                <div className="ide-welcome-card">
                  <h2>{t('painter.welcome.title')}</h2>
                  <p>{t('painter.welcome.body')}</p>
                  <div className="ide-section">
                    <h3 className="ide-section-title">{t('painter.welcome.newMap')}</h3>
                    <div className="ide-row">
                      <GameTilesetPicker
                        label={t('painter.gameA')}
                        games={games}
                        gameId={gameAId}
                        onGameChange={setGameAId}
                        tilesetId={tilesetAId}
                        onTilesetChange={setTilesetAId}
                        selectGameLabel={t('painter.selectGame')}
                        selectTilesetLabel={t('painter.selectTileset')}
                      />
                    </div>
                    <div className="ide-row">
                      <GameTilesetPicker
                        label={t('painter.gameB')}
                        games={games}
                        gameId={gameBId}
                        onGameChange={setGameBId}
                        tilesetId={tilesetBId}
                        onTilesetChange={setTilesetBId}
                        selectGameLabel={t('painter.selectGame')}
                        selectTilesetLabel={t('painter.selectTileset')}
                      />
                    </div>
                    <div className="ide-row">
                      <button
                        type="button"
                        className="primary"
                        disabled={tilesetAId === undefined || tilesetBId === undefined}
                        onClick={handleCreateMap}
                      >
                        {t('painter.createMap')}
                      </button>
                      <button type="button" onClick={handleLoad}>
                        {t('painter.load')}
                      </button>
                    </div>
                  </div>
                  {statusMessage && <p className="ide-hint">{statusMessage}</p>}
                </div>
              </div>
            )}
          </div>

          {mapReady && painterState && paletteSlots.length > 0 && (
            <section className="ide-palette-dock" aria-label={t('painter.paletteDock')}>
              <div
                className="ide-palette-roles"
                role="radiogroup"
                aria-label={t('painter.palette.role')}
              >
                <span className="ide-palette-roles-label">{t('painter.palette.role')}</span>
                {PROCGEN_PALETTE_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={paletteRole === role}
                    className={
                      paletteRole === role
                        ? 'ide-palette-role ide-palette-role-active'
                        : 'ide-palette-role'
                    }
                    onClick={() => setPaletteRole(role)}
                  >
                    {t(`painter.palette.role.${role}`)}
                  </button>
                ))}
              </div>
              <p className="ide-hint ide-palette-role-hint">
                {t(`painter.palette.role.${paletteRole}.hint`)}
              </p>
              {paletteSlots.map((paletteSlot) => (
                <TilePalette
                  key={paletteSlot.slot}
                  label={formatTemplate(t('painter.paletteFor'), { slot: paletteSlot.slot })}
                  sheet={paletteSlot.slot}
                  imageUrl={paletteSlot.imageUrl}
                  pixelSize={paletteSlot.pixelSize}
                  tilePixelSize={paletteSlot.tilePixelSize}
                  selectedTileId={selectedTileIdForRole(paletteRole, {
                    fillTileId: painterState.fillTileId,
                    wallOverride: procgenWallTileId,
                    doorOverride: procgenDoorTileId,
                    furnitureOverride: procgenFurnitureTileId,
                  })}
                  onSelect={(tileId) => {
                    const assignment = assignmentFromPaletteClick(paletteRole, tileId);
                    if (assignment.setFill !== undefined) {
                      viewportRef.current?.setFillTileId(assignment.setFill);
                    }
                    if (assignment.setWallOverride !== undefined) {
                      setProcgenWallTileId(assignment.setWallOverride);
                    }
                    if (assignment.setDoorOverride !== undefined) {
                      setProcgenDoorTileId(assignment.setDoorOverride);
                    }
                    if (assignment.setFurnitureOverride !== undefined) {
                      setProcgenFurnitureTileId(assignment.setFurnitureOverride);
                    }
                    const status = statusForPaletteAssignment(assignment);
                    if (status) {
                      setStatusMessage(formatTemplate(t(status.messageKey), { id: status.id }));
                    }
                  }}
                  tileAriaLabel={(tileId) =>
                    formatTemplate(t('painter.paletteTile'), { id: tileId })
                  }
                />
              ))}
            </section>
          )}
        </div>

        <aside className="ide-inspector" aria-label={t('painter.inspector')}>
          <div className="ide-inspector-tabs" role="tablist">
            {INSPECTOR_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab}
                className={`ide-inspector-tab${inspectorTab === tab ? ' ide-inspector-tab-active' : ''}`}
                onClick={() => setInspectorTab(tab)}
              >
                {t(`painter.inspector.${tab}`)}
              </button>
            ))}
          </div>

          <div className="ide-inspector-body" role="tabpanel">
            {!(mapReady && painterState) ? (
              <section className="ide-section">
                <div className="ide-empty" role="status">
                  <p className="ide-empty-title">{t('painter.empty.noMapTitle')}</p>
                  <p className="ide-hint">{t('painter.empty.noMapBody')}</p>
                </div>
                <h3 className="ide-section-title">{t('painter.project')}</h3>
                <div className="ide-row">
                  <GameTilesetPicker
                    label={t('painter.gameA')}
                    games={games}
                    gameId={gameAId}
                    onGameChange={setGameAId}
                    tilesetId={tilesetAId}
                    onTilesetChange={setTilesetAId}
                    selectGameLabel={t('painter.selectGame')}
                    selectTilesetLabel={t('painter.selectTileset')}
                  />
                </div>
                <div className="ide-row">
                  <GameTilesetPicker
                    label={t('painter.gameB')}
                    games={games}
                    gameId={gameBId}
                    onGameChange={setGameBId}
                    tilesetId={tilesetBId}
                    onTilesetChange={setTilesetBId}
                    selectGameLabel={t('painter.selectGame')}
                    selectTilesetLabel={t('painter.selectTileset')}
                  />
                </div>
                <div className="ide-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={tilesetAId === undefined || tilesetBId === undefined}
                    onClick={handleCreateMap}
                  >
                    {t('painter.createMap')}
                  </button>
                  <button type="button" onClick={handleLoad}>
                    {t('painter.load')}
                  </button>
                </div>
              </section>
            ) : (
              <>
                {inspectorTab === 'map' && (
                  <>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.rooms')}</h3>
                      <div className="ide-row">
                        <button
                          type="button"
                          onClick={() => {
                            viewportRef.current?.setActiveRoomId(undefined);
                            viewportRef.current?.setTool('room-box');
                          }}
                        >
                          {t('painter.room.new')}
                        </button>
                        <button type="button" onClick={() => viewportRef.current?.undoRoom()}>
                          {t('painter.room.undo')}
                        </button>
                        <button type="button" onClick={() => viewportRef.current?.redoRoom()}>
                          {t('painter.room.redo')}
                        </button>
                      </div>
                      {floorRooms.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.rooms.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.rooms.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list">
                          {floorRooms.map((room) => (
                            <li
                              key={room.id}
                              className={
                                painterState.activeRoomId === room.id
                                  ? 'ide-list-active'
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  viewportRef.current?.setActiveRoomId(room.id);
                                  viewportRef.current?.setTool('room-box');
                                }}
                              >
                                {room.name ??
                                  formatTemplate(t('painter.room.unnamed'), { id: room.id })}
                              </button>
                              <input
                                type="text"
                                aria-label={t('painter.room.renamePlaceholder')}
                                placeholder={t('painter.room.renamePlaceholder')}
                                defaultValue={room.name ?? ''}
                                onBlur={(event) => {
                                  const value = event.target.value.trim();
                                  viewportRef.current?.renameRoom(
                                    room.id,
                                    value.length > 0 ? value : undefined,
                                  );
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeRoom(room.id)}
                              >
                                {t('painter.room.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.stairLinks')}</h3>
                      {painterState.pendingStairEntry && (
                        <p className="ide-hint">{t('painter.stairLink.pendingHint')}</p>
                      )}
                      {painterState.stairLinks.length === 0 && !painterState.pendingStairEntry ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.stairLinks.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.stairLinks.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list">
                          {painterState.stairLinks.map((link) => (
                            <li key={link.id}>
                              <span>
                                {formatTemplate(t('painter.stairLink.summary'), {
                                  from: resolveFloorLabel(painterState.floors, link.fromFloor, t),
                                  to: resolveFloorLabel(painterState.floors, link.toFloor, t),
                                })}
                              </span>
                              <label className="ide-check">
                                <input
                                  type="checkbox"
                                  checked={link.bidirectional}
                                  onChange={() =>
                                    viewportRef.current?.toggleStairLinkBidirectional(link.id)
                                  }
                                />
                                {t('painter.stairLink.bidirectional')}
                              </label>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeStairLink(link.id)}
                              >
                                {t('painter.stairLink.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.spawn')}</h3>
                      {painterState.spawn ? (
                        <div className="ide-row">
                          <span>
                            {formatTemplate(t('painter.spawn.summary'), {
                              floor: resolveFloorLabel(
                                painterState.floors,
                                painterState.spawn.floor,
                                t,
                              ),
                              x: painterState.spawn.x,
                              y: painterState.spawn.y,
                            })}
                          </span>
                          <button type="button" onClick={() => viewportRef.current?.clearSpawn()}>
                            {t('painter.spawn.clear')}
                          </button>
                        </div>
                      ) : (
                        <p className="ide-hint">{t('painter.spawn.notSet')}</p>
                      )}
                    </section>
                  </>
                )}

                {inspectorTab === 'paint' && (
                  <>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.layers')}</h3>
                      <p className="ide-hint">{t('painter.layers.hint')}</p>
                      <ul className="layers-list">
                        {[...PAINT_LAYERS].reverse().map((layer) => (
                          <li key={layer.index}>
                            <button
                              type="button"
                              className={`layers-btn${
                                painterState.activeLayer === layer.index ? ' layers-btn-active' : ''
                              }`}
                              onClick={() => viewportRef.current?.setActiveLayer(layer.index)}
                            >
                              <span className="layers-btn-index">{layer.index}</span>
                              <span className="layers-btn-name">{t(layer.nameKey)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="ide-section">
                      <h3 className="ide-section-title">
                        {t(`painter.tool.${painterState.tool}`)}
                      </h3>
                      <p className="ide-hint">{t('painter.paint.hint')}</p>
                      <label className="painter-advanced-fill">
                        {t('painter.advancedFillTileId')}
                        <input
                          type="number"
                          value={painterState.fillTileId}
                          onChange={(event) =>
                            viewportRef.current?.setFillTileId(Number(event.target.value))
                          }
                        />
                      </label>
                    </section>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.project')}</h3>
                      <div className="ide-row">
                        <GameTilesetPicker
                          label={t('painter.gameA')}
                          games={games}
                          gameId={gameAId}
                          onGameChange={setGameAId}
                          tilesetId={tilesetAId}
                          onTilesetChange={setTilesetAId}
                          selectGameLabel={t('painter.selectGame')}
                          selectTilesetLabel={t('painter.selectTileset')}
                        />
                      </div>
                      <div className="ide-row">
                        <GameTilesetPicker
                          label={t('painter.gameB')}
                          games={games}
                          gameId={gameBId}
                          onGameChange={setGameBId}
                          tilesetId={tilesetBId}
                          onTilesetChange={setTilesetBId}
                          selectGameLabel={t('painter.selectGame')}
                          selectTilesetLabel={t('painter.selectTileset')}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={tilesetAId === undefined || tilesetBId === undefined}
                        onClick={handleCreateMap}
                      >
                        {t('painter.createMap')}
                      </button>
                    </section>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.procgen')}</h3>
                      <p className="ide-hint">{t('painter.procgen.hint')}</p>
                      <label>
                        {t('painter.procgen.preset')}
                        <select
                          value={procgenPreset}
                          onChange={(event) =>
                            setProcgenPreset(event.target.value as ProcgenPresetId)
                          }
                        >
                          {PROCGEN_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {t(`painter.procgen.preset.${p.id}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="ide-row">
                        <label>
                          {t('painter.procgen.seed')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={procgenSeed}
                            onChange={(event) => {
                              const n = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(n)) setProcgenSeed(n >>> 0);
                            }}
                          />
                        </label>
                        <button type="button" onClick={() => setProcgenSeed(randomProcgenSeed())}>
                          {t('painter.procgen.randomizeSeed')}
                        </button>
                      </div>
                      {procgenSeedHistory.length > 0 && (
                        <div
                          className="ide-row ide-seed-history"
                          role="group"
                          aria-label={t('painter.procgen.seedHistory')}
                        >
                          <span className="ide-hint">{t('painter.procgen.seedHistory')}:</span>
                          {procgenSeedHistory.map((s) => (
                            <button
                              key={s}
                              type="button"
                              className={
                                procgenSeed === s
                                  ? 'ide-seed-history-btn ide-seed-history-btn-active'
                                  : 'ide-seed-history-btn'
                              }
                              title={formatTemplate(t('painter.procgen.seedHistoryUse'), {
                                seed: s,
                              })}
                              onClick={() => setProcgenSeed(s >>> 0)}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <label>
                        {t('painter.procgen.furnitureDensity')}
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={furnitureDensityToPercent(procgenFurnitureDensity)}
                          onChange={(event) => {
                            const n = Number.parseInt(event.target.value, 10);
                            if (Number.isFinite(n)) {
                              setProcgenFurnitureDensity(furnitureDensityFromPercent(n));
                            }
                          }}
                          aria-valuetext={formatTemplate(
                            t('painter.procgen.furnitureDensityValue'),
                            {
                              percent: furnitureDensityToPercent(procgenFurnitureDensity),
                            },
                          )}
                        />
                      </label>
                      <p className="ide-hint">
                        {formatTemplate(t('painter.procgen.furnitureDensityValue'), {
                          percent: furnitureDensityToPercent(procgenFurnitureDensity),
                        })}{' '}
                        {t('painter.procgen.furnitureDensityHint')}
                      </p>
                      <div className="ide-row">
                        <label>
                          {t('painter.procgen.wallTile')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={procgenWallTileId}
                            onChange={(event) => {
                              const n = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(n)) setProcgenWallTileId(Math.max(0, n));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          title={t('painter.procgen.wallFromBrushHint')}
                          onClick={() => {
                            const fill = painterState.fillTileId;
                            if (fill > 0) setProcgenWallTileId(fill);
                          }}
                        >
                          {t('painter.procgen.wallFromBrush')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setProcgenWallTileId(0)}
                          title={t('painter.procgen.wallAutoHint')}
                        >
                          {t('painter.procgen.wallAuto')}
                        </button>
                      </div>
                      <p className="ide-hint">
                        {procgenWallTileId > 0
                          ? formatTemplate(t('painter.procgen.wallTileActive'), {
                              id: procgenWallTileId,
                            })
                          : t('painter.procgen.wallTileAuto')}
                      </p>
                      <div className="ide-row">
                        <label>
                          {t('painter.procgen.doorTile')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={procgenDoorTileId}
                            onChange={(event) => {
                              const n = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(n)) setProcgenDoorTileId(Math.max(0, n));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          title={t('painter.procgen.doorFromBrushHint')}
                          onClick={() => {
                            const fill = painterState.fillTileId;
                            if (fill > 0) setProcgenDoorTileId(fill);
                          }}
                        >
                          {t('painter.procgen.doorFromBrush')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setProcgenDoorTileId(0)}
                          title={t('painter.procgen.doorAutoHint')}
                        >
                          {t('painter.procgen.doorAuto')}
                        </button>
                      </div>
                      <p className="ide-hint">
                        {procgenDoorTileId > 0
                          ? formatTemplate(t('painter.procgen.doorTileActive'), {
                              id: procgenDoorTileId,
                            })
                          : t('painter.procgen.doorTileAuto')}
                      </p>
                      <div className="ide-row">
                        <label>
                          {t('painter.procgen.furnitureTile')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={procgenFurnitureTileId}
                            onChange={(event) => {
                              const n = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(n)) setProcgenFurnitureTileId(Math.max(0, n));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          title={t('painter.procgen.furnitureFromBrushHint')}
                          onClick={() => {
                            const fill = painterState.fillTileId;
                            if (fill > 0) setProcgenFurnitureTileId(fill);
                          }}
                        >
                          {t('painter.procgen.furnitureFromBrush')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setProcgenFurnitureTileId(0)}
                          title={t('painter.procgen.furnitureAutoHint')}
                        >
                          {t('painter.procgen.furnitureAuto')}
                        </button>
                      </div>
                      <p className="ide-hint">
                        {procgenFurnitureTileId > 0
                          ? formatTemplate(t('painter.procgen.furnitureTileActive'), {
                              id: procgenFurnitureTileId,
                            })
                          : t('painter.procgen.furnitureTileAuto')}
                      </p>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleGenerateDungeon()}
                      >
                        {t('painter.procgen.generate')}
                      </button>
                    </section>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.community')}</h3>
                      <p className="ide-hint">{t('painter.community.hint')}</p>
                      <p
                        className={
                          communityStatus.kind === 'off'
                            ? 'ide-status-badge ide-status-badge-muted'
                            : communityStatus.kind === 'queued'
                              ? 'ide-status-badge ide-status-badge-ok'
                              : 'ide-status-badge'
                        }
                        role="status"
                      >
                        {communityStatus.kind === 'off'
                          ? t('painter.community.statusOff')
                          : communityStatus.kind === 'ready'
                            ? t('painter.community.statusReady')
                            : formatTemplate(t('painter.community.statusQueued'), {
                                count: communityStatus.queueLength,
                                name: communityStatus.lastMapName ?? '',
                              })}
                      </p>
                      {communityQueue.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">
                            {t('painter.community.queueEmptyTitle')}
                          </p>
                          <p className="ide-hint">{t('painter.community.queueEmptyBody')}</p>
                        </div>
                      ) : (
                        <>
                          <ul className="ide-list" aria-label={t('painter.community.queueList')}>
                            {communityQueue.map((job) => (
                              <li key={`${job.mapId}:${job.at}`}>
                                <span>
                                  {formatTemplate(t('painter.community.queueItem'), {
                                    name: job.mapName,
                                    id: formatCommunityShareMapId(job.mapId),
                                    version: String(job.version),
                                    license: t(`painter.community.license.${job.licenseTag}`),
                                    tiles: String(communityShareTileCount(job.tileObjectShas)),
                                    at: formatCommunityShareAt(job.at),
                                  })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const payload = serializeCommunityShareQueue([job]);
                                    void navigator.clipboard?.writeText(payload).then(
                                      () =>
                                        setStatusMessage(
                                          formatTemplate(t('painter.community.jobCopied'), {
                                            name: job.mapName,
                                          }),
                                        ),
                                      () =>
                                        setStatusMessage(t('painter.community.queueCopyFailed')),
                                    );
                                  }}
                                >
                                  {t('painter.community.copyJob')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCommunityQueue(
                                      removeCommunityShareQueueJob(job.mapId, job.at),
                                    );
                                    setStatusMessage(
                                      formatTemplate(t('painter.community.queueItemRemoved'), {
                                        name: job.mapName,
                                      }),
                                    );
                                  }}
                                >
                                  {t('painter.community.removeJob')}
                                </button>
                              </li>
                            ))}
                          </ul>
                          <p className="ide-hint" role="status">
                            {formatTemplate(t('painter.community.queueTileTotal'), {
                              tiles: String(communityShareQueueTileTotal(communityQueue)),
                            })}
                          </p>
                          <p className="ide-hint">
                            {communityShareQueueLicenseCounts(communityQueue)
                              .map(({ tag, count }) =>
                                formatTemplate(t('painter.community.queueLicenseCount'), {
                                  count: String(count),
                                  license: t(`painter.community.license.${tag}`),
                                }),
                              )
                              .join(' · ')}
                          </p>
                        </>
                      )}
                      <div className="ide-row">
                        <button
                          type="button"
                          disabled={communityQueue.length === 0}
                          onClick={() => {
                            const payload = serializeCommunityShareQueue(communityQueue);
                            void navigator.clipboard?.writeText(payload).then(
                              () => setStatusMessage(t('painter.community.queueCopied')),
                              () => setStatusMessage(t('painter.community.queueCopyFailed')),
                            );
                          }}
                        >
                          {t('painter.community.copyQueue')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const clipboard = navigator.clipboard;
                            if (!clipboard?.readText) {
                              setStatusMessage(t('painter.community.queuePasteFailed'));
                              return;
                            }
                            void clipboard.readText().then(
                              (raw) => {
                                const parsed = parseCommunityShareQueueJson(raw);
                                if (!parsed.ok) {
                                  setStatusMessage(
                                    t(`painter.community.queuePaste.${parsed.reason}`),
                                  );
                                  return;
                                }
                                setCommunityQueue(replaceCommunityShareQueue(parsed.jobs));
                                setStatusMessage(
                                  formatTemplate(t('painter.community.queuePasted'), {
                                    count: parsed.jobs.length,
                                  }),
                                );
                              },
                              () => setStatusMessage(t('painter.community.queuePasteFailed')),
                            );
                          }}
                        >
                          {t('painter.community.pasteQueue')}
                        </button>
                        {communityQueue.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCommunityQueue(clearCommunityShareQueue());
                              setStatusMessage(t('painter.community.queueCleared'));
                            }}
                          >
                            {t('painter.community.clearQueue')}
                          </button>
                        )}
                      </div>
                      <label className="ide-check">
                        <input
                          type="checkbox"
                          checked={community.shareOnSave}
                          onChange={(event) => {
                            const next = {
                              ...community,
                              shareOnSave: event.target.checked,
                            };
                            setCommunity(next);
                            saveCommunitySettings(next);
                          }}
                        />
                        {t('painter.community.shareOnSave')}
                      </label>
                      <label className="ide-check">
                        <input
                          type="checkbox"
                          checked={community.allowImportedAssets}
                          onChange={(event) => {
                            const next = {
                              ...community,
                              allowImportedAssets: event.target.checked,
                            };
                            setCommunity(next);
                            saveCommunitySettings(next);
                          }}
                        />
                        {t('painter.community.allowImported')}
                      </label>
                    </section>
                  </>
                )}

                {inspectorTab === 'events' && (
                  <div className="events-workbench">
                    <h3 className="ide-section-title">{t('painter.events')}</h3>
                    {eventsValidationError !== null && (
                      <p className="painter-events-validation-error" role="alert">
                        {eventsValidationError}
                      </p>
                    )}
                    {painterState.eventKeys.length === 0 && (
                      <div className="ide-empty" role="status">
                        <p className="ide-empty-title">{t('painter.events.emptyTitle')}</p>
                        <p className="ide-hint">{t('painter.events.emptyBody')}</p>
                      </div>
                    )}
                    <ul className="events-key-list">
                      {painterState.eventKeys.map((key) => {
                        const referenced = isEventReferenced(painterState, key);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className={`events-key-select${key === selectedEventKey ? ' events-key-selected' : ''}`}
                              onClick={() => setSelectedEventKey(key)}
                            >
                              {key}
                            </button>
                            <button
                              type="button"
                              className="events-key-delete"
                              disabled={referenced}
                              title={
                                referenced
                                  ? t('painter.events.deleteReferenced')
                                  : t('painter.events.delete')
                              }
                              onClick={() => {
                                viewportRef.current?.removeEvent(key);
                                if (selectedEventKey === key) setSelectedEventKey(undefined);
                              }}
                            >
                              {t('painter.events.delete')}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="painter-events-add-event">
                      <input
                        type="text"
                        value={newEventKey}
                        placeholder={t('painter.events.addPlaceholder')}
                        onChange={(event) => setNewEventKey(event.target.value)}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={newEventKey.trim() === ''}
                        onClick={() => {
                          const key = newEventKey.trim();
                          if (key === '') return;
                          viewportRef.current?.addEvent(key);
                          setSelectedEventKey(key);
                          setNewEventKey('');
                        }}
                      >
                        {t('painter.events.add')}
                      </button>
                    </div>

                    {selectedEventKey !== undefined && painterState.events[selectedEventKey] ? (
                      <div className="events-detail">
                        <p className="events-detail-title">
                          {formatTemplate(t('painter.events.commandsFor'), {
                            key: selectedEventKey,
                          })}
                        </p>
                        <CommandList
                          t={t}
                          basePath={[]}
                          commands={painterState.events[selectedEventKey] ?? []}
                          onUpdate={(path, patch) =>
                            viewportRef.current?.updateCommand(selectedEventKey, path, patch)
                          }
                          onRemove={(path) =>
                            viewportRef.current?.removeCommand(selectedEventKey, path)
                          }
                          onMove={(path, delta) =>
                            viewportRef.current?.moveCommand(selectedEventKey, path, delta)
                          }
                          onAdd={(path, kind) =>
                            viewportRef.current?.addCommand(selectedEventKey, path, kind)
                          }
                        />
                      </div>
                    ) : (
                      <p className="ide-hint">{t('painter.events.noSelection')}</p>
                    )}

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.events.worldSeeds')}</h3>
                      <ul className="ide-list">
                        {Object.entries(painterState.worldSeeds).map(([key, value]) => {
                          const kind = worldValueKind(value);
                          return (
                            <li key={key}>
                              <span style={{ fontFamily: 'var(--tm-mono)' }}>{key}</span>
                              <select
                                value={kind}
                                aria-label={t('painter.events.worldValueType')}
                                onChange={(event) => {
                                  const next = event.target.value as WorldValueKind;
                                  viewportRef.current?.setWorldSeed(
                                    key,
                                    defaultWorldSeedValue(next),
                                  );
                                }}
                              >
                                <option value="boolean">
                                  {t('painter.events.worldValueType.boolean')}
                                </option>
                                <option value="number">
                                  {t('painter.events.worldValueType.number')}
                                </option>
                                <option value="string">
                                  {t('painter.events.worldValueType.string')}
                                </option>
                              </select>
                              {kind === 'boolean' ? (
                                <label className="ide-check">
                                  <input
                                    type="checkbox"
                                    checked={value === true}
                                    onChange={(event) =>
                                      viewportRef.current?.setWorldSeed(key, event.target.checked)
                                    }
                                  />
                                  {t('painter.events.field.value')}
                                </label>
                              ) : (
                                <input
                                  type={kind === 'number' ? 'number' : 'text'}
                                  value={String(value)}
                                  onChange={(event) =>
                                    viewportRef.current?.setWorldSeed(
                                      key,
                                      parseWorldValue(kind, event.target.value),
                                    )
                                  }
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeWorldSeed(key)}
                              >
                                {t('painter.events.worldSeeds.remove')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="painter-events-add-world-seed">
                        <input
                          type="text"
                          value={newWorldSeedKey}
                          placeholder={t('painter.events.worldSeeds.keyPlaceholder')}
                          onChange={(event) => setNewWorldSeedKey(event.target.value)}
                        />
                        <select
                          value={newWorldSeedKind}
                          onChange={(event) =>
                            setNewWorldSeedKind(event.target.value as WorldValueKind)
                          }
                          aria-label={t('painter.events.worldValueType')}
                        >
                          <option value="boolean">
                            {t('painter.events.worldValueType.boolean')}
                          </option>
                          <option value="number">
                            {t('painter.events.worldValueType.number')}
                          </option>
                          <option value="string">
                            {t('painter.events.worldValueType.string')}
                          </option>
                        </select>
                        <button
                          type="button"
                          disabled={newWorldSeedKey.trim() === ''}
                          onClick={() => {
                            const key = newWorldSeedKey.trim();
                            if (key === '') return;
                            viewportRef.current?.setWorldSeed(
                              key,
                              defaultWorldSeedValue(newWorldSeedKind),
                            );
                            setNewWorldSeedKey('');
                          }}
                        >
                          {t('painter.events.worldSeeds.add')}
                        </button>
                      </div>
                    </section>
                  </div>
                )}

                {inspectorTab === 'ink' && (
                  <InkPanel t={t} painterState={painterState} onStatus={setStatusMessage} />
                )}

                {inspectorTab === 'entities' && (
                  <>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.props')}</h3>
                      <label>
                        {t('painter.props.pickGlb')}
                        <input
                          ref={glbInputRef}
                          type="file"
                          accept=".glb"
                          onChange={handleGlbFile}
                        />
                      </label>
                      <span className="ide-hint">
                        {painterState.activePropObject
                          ? formatTemplate(t('painter.props.currentObject'), {
                              sha: shortSha(painterState.activePropObject),
                            })
                          : t('painter.props.noObject')}
                      </span>
                      {!painterState.activePropObject && painterState.tool === 'prop' && (
                        <p className="ide-hint">{t('painter.props.selectHint')}</p>
                      )}
                      <h4 className="ide-section-subtitle">{t('painter.props.library')}</h4>
                      <p className="ide-hint">{t('painter.props.libraryHint')}</p>
                      {objectLibrary.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.props.libraryEmptyTitle')}</p>
                          <p className="ide-hint">{t('painter.props.libraryEmptyBody')}</p>
                        </div>
                      ) : (
                        <ul
                          className="ide-list ide-list-objects"
                          aria-label={t('painter.props.library')}
                        >
                          {objectLibrary.map((objectSha) => (
                            <li
                              key={objectSha}
                              className={
                                painterState.activePropObject === objectSha
                                  ? 'ide-list-active'
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  viewportRef.current?.setActivePropObject(objectSha);
                                  viewportRef.current?.setTool('prop');
                                  setStatusMessage(
                                    formatTemplate(t('painter.props.selectedToast'), {
                                      sha: shortSha(objectSha),
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.props.selectObject'), {
                                  sha: shortSha(objectSha),
                                })}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="painter-place-at-tile">
                        <label>
                          {t('painter.placeAtTile.x')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.width - 1)}
                            step={1}
                            value={propPlaceX}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setPropPlaceX(parsed);
                            }}
                          />
                        </label>
                        <label>
                          {t('painter.placeAtTile.y')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.height - 1)}
                            step={1}
                            value={propPlaceY}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setPropPlaceY(parsed);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!painterState.activePropObject}
                          onClick={() =>
                            viewportRef.current?.placePropAtTile(propPlaceX, propPlaceY)
                          }
                        >
                          {t('painter.placeAtTile')}
                        </button>
                      </div>
                      {floorProps.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.props.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.props.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list" aria-label={t('painter.props')}>
                          {floorProps.map((prop) => (
                            <li
                              key={prop.id}
                              className={
                                painterState.activePropObject === prop.object
                                  ? 'ide-list-active'
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  const brush = propPlacementFromDocument(prop);
                                  viewportRef.current?.setActivePropObject(brush.object);
                                  viewportRef.current?.setTool('prop');
                                  setStatusMessage(
                                    formatTemplate(t('painter.props.reuseToast'), {
                                      id: prop.id,
                                      sha: shortSha(brush.object),
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.props.summary'), {
                                  id: prop.id,
                                  x: prop.x,
                                  y: prop.y,
                                  sha: shortSha(prop.object),
                                })}
                              </button>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeProp(prop.id)}
                              >
                                {t('painter.props.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.npcs')}</h3>
                      <p className="ide-hint">{t('painter.npcs.eventsHint')}</p>
                      {painterState.eventKeys.length === 0 && (
                        <p className="ide-hint">{t('painter.npcs.noEventsHint')}</p>
                      )}
                      <label>
                        {t('painter.npcs.sprite')}
                        <select
                          name="npc-sprite"
                          value={painterState.activeNpcSpriteObject ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            viewportRef.current?.setActiveNpcSpriteObject(
                              value === '' ? undefined : value,
                            );
                          }}
                        >
                          <option value="">{t('painter.npcs.noSprite')}</option>
                          {characterSprites.map((asset) => (
                            <option key={asset.sha256} value={asset.sha256}>
                              {shortSha(asset.sha256)}
                              {asset.relPath ? ` — ${asset.relPath}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="ide-row">
                        <label>
                          {t('painter.npcs.characterIndex')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={painterState.activeNpcCharacterIndex}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) {
                                viewportRef.current?.setActiveNpcCharacterIndex(parsed);
                              }
                            }}
                          />
                        </label>
                        <label>
                          {t('painter.npcs.facing')}
                          <select
                            value={painterState.activeNpcFacing}
                            onChange={(event) =>
                              viewportRef.current?.setActiveNpcFacing(
                                event.target.value as NpcFacing,
                              )
                            }
                          >
                            {NPC_FACINGS.map((facing) => (
                              <option key={facing} value={facing}>
                                {t(`painter.npcs.facing.${facing}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        {t('painter.npcs.event')}
                        <select
                          name="npc-event"
                          value={painterState.activeNpcEventKey ?? ''}
                          disabled={painterState.eventKeys.length === 0}
                          onChange={(event) => {
                            const value = event.target.value;
                            viewportRef.current?.setActiveNpcEventKey(
                              value === '' ? undefined : value,
                            );
                          }}
                        >
                          {painterState.eventKeys.length === 0 ? (
                            <option value="">{t('painter.npcs.noEvents')}</option>
                          ) : (
                            painterState.eventKeys.map((key) => (
                              <option key={key} value={key}>
                                {key}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                      <div className="painter-place-at-tile">
                        <label>
                          {t('painter.placeAtTile.x')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.width - 1)}
                            step={1}
                            value={npcPlaceX}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setNpcPlaceX(parsed);
                            }}
                          />
                        </label>
                        <label>
                          {t('painter.placeAtTile.y')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.height - 1)}
                            step={1}
                            value={npcPlaceY}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setNpcPlaceY(parsed);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            !painterState.activeNpcSpriteObject ||
                            painterState.eventKeys.length === 0
                          }
                          onClick={() => viewportRef.current?.placeNpcAtTile(npcPlaceX, npcPlaceY)}
                        >
                          {t('painter.placeAtTile')}
                        </button>
                      </div>
                      {floorNpcs.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.npcs.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.npcs.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list" aria-label={t('painter.npcs')}>
                          {floorNpcs.map((npc) => (
                            <li key={npc.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  const brush = npcPlacementFromDocument(npc);
                                  viewportRef.current?.setActiveNpcSpriteObject(brush.spriteObject);
                                  viewportRef.current?.setActiveNpcCharacterIndex(
                                    brush.characterIndex,
                                  );
                                  viewportRef.current?.setActiveNpcFacing(brush.facing);
                                  viewportRef.current?.setActiveNpcEventKey(brush.eventKey);
                                  viewportRef.current?.setTool('npc');
                                  setStatusMessage(
                                    formatTemplate(t('painter.npcs.reuseToast'), {
                                      id: npc.id,
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.npcs.summary'), {
                                  id: npc.id,
                                  x: npc.x,
                                  y: npc.y,
                                  event: npc.onInteract,
                                })}
                              </button>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeNpc(npc.id)}
                              >
                                {t('painter.npcs.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.triggers')}</h3>
                      <p className="ide-hint">{t('painter.triggers.eventsHint')}</p>
                      {painterState.eventKeys.length === 0 && (
                        <p className="ide-hint">{t('painter.triggers.noEventsHint')}</p>
                      )}
                      <fieldset className="ide-fieldset">
                        <legend>{t('painter.triggers.on')}</legend>
                        <label className="ide-check">
                          <input
                            type="radio"
                            name="trigger-on"
                            checked={painterState.activeTriggerOn === 'enter'}
                            onChange={() => viewportRef.current?.setActiveTriggerOn('enter')}
                          />
                          {t('painter.triggers.on.enter')}
                        </label>
                        <label className="ide-check">
                          <input
                            type="radio"
                            name="trigger-on"
                            checked={painterState.activeTriggerOn === 'interact'}
                            onChange={() => viewportRef.current?.setActiveTriggerOn('interact')}
                          />
                          {t('painter.triggers.on.interact')}
                        </label>
                      </fieldset>
                      <label>
                        {t('painter.triggers.event')}
                        <select
                          name="trigger-event"
                          value={painterState.activeTriggerEventKey ?? ''}
                          disabled={painterState.eventKeys.length === 0}
                          onChange={(event) => {
                            const value = event.target.value;
                            viewportRef.current?.setActiveTriggerEventKey(
                              value === '' ? undefined : value,
                            );
                          }}
                        >
                          {painterState.eventKeys.length === 0 ? (
                            <option value="">{t('painter.triggers.noEvents')}</option>
                          ) : (
                            painterState.eventKeys.map((key) => (
                              <option key={key} value={key}>
                                {key}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                      <div className="painter-place-at-tile">
                        <label>
                          {t('painter.placeAtTile.x')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.width - 1)}
                            step={1}
                            value={triggerPlaceX}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setTriggerPlaceX(parsed);
                            }}
                          />
                        </label>
                        <label>
                          {t('painter.placeAtTile.y')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.height - 1)}
                            step={1}
                            value={triggerPlaceY}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setTriggerPlaceY(parsed);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            painterState.eventKeys.length === 0 ||
                            !painterState.activeTriggerEventKey
                          }
                          onClick={() =>
                            viewportRef.current?.placeTriggerAtTile(triggerPlaceX, triggerPlaceY)
                          }
                        >
                          {t('painter.placeAtTile')}
                        </button>
                      </div>
                      {floorTriggers.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.triggers.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.triggers.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list" aria-label={t('painter.triggers')}>
                          {floorTriggers.map((trigger) => (
                            <li key={trigger.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  const brush = triggerPlacementFromDocument(trigger);
                                  viewportRef.current?.setActiveTriggerOn(brush.on);
                                  viewportRef.current?.setActiveTriggerEventKey(brush.eventKey);
                                  viewportRef.current?.setTool('trigger');
                                  setStatusMessage(
                                    formatTemplate(t('painter.triggers.reuseToast'), {
                                      id: trigger.id,
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.triggers.summary'), {
                                  id: trigger.id,
                                  x: trigger.x,
                                  y: trigger.y,
                                  on: trigger.on,
                                  event: trigger.event,
                                })}
                              </button>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeTrigger(trigger.id)}
                              >
                                {t('painter.triggers.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.lights')}</h3>
                      <p className="ide-hint">{t('painter.lights.hint')}</p>
                      <div className="ide-row">
                        <button type="button" onClick={() => viewportRef.current?.undoLight()}>
                          {t('painter.lights.undo')}
                        </button>
                        <button type="button" onClick={() => viewportRef.current?.redoLight()}>
                          {t('painter.lights.redo')}
                        </button>
                      </div>
                      <fieldset className="ide-fieldset">
                        <legend>{t('painter.lights.kind')}</legend>
                        {LIGHT_KINDS.map((kind) => (
                          <label key={kind} className="ide-check">
                            <input
                              type="radio"
                              name="light-kind"
                              checked={painterState.activeLightKind === kind}
                              onChange={() => viewportRef.current?.setActiveLightKind(kind)}
                            />
                            {t(`painter.lights.kind.${kind}`)}
                          </label>
                        ))}
                      </fieldset>
                      <label>
                        {t('painter.lights.color')}
                        <input
                          type="text"
                          value={painterState.activeLightColor}
                          spellCheck={false}
                          onChange={(event) =>
                            viewportRef.current?.setActiveLightColor(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        {t('painter.lights.intensity')}
                        <input
                          type="number"
                          min={0.01}
                          max={50}
                          step={0.1}
                          value={painterState.activeLightIntensity}
                          onChange={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            if (Number.isFinite(parsed)) {
                              viewportRef.current?.setActiveLightIntensity(parsed);
                            }
                          }}
                        />
                      </label>
                      <label>
                        {t('painter.lights.range')}
                        <input
                          type="number"
                          min={0.01}
                          max={64}
                          step={0.5}
                          value={painterState.activeLightRange}
                          onChange={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            if (Number.isFinite(parsed)) {
                              viewportRef.current?.setActiveLightRange(parsed);
                            }
                          }}
                        />
                      </label>
                      <label>
                        {t('painter.lights.height')}
                        <input
                          type="number"
                          min={0}
                          max={32}
                          step={0.25}
                          value={painterState.activeLightHeight}
                          onChange={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            if (Number.isFinite(parsed)) {
                              viewportRef.current?.setActiveLightHeight(parsed);
                            }
                          }}
                        />
                      </label>
                      <div className="painter-place-at-tile">
                        <label>
                          {t('painter.placeAtTile.x')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.width - 1)}
                            step={1}
                            value={lightPlaceX}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setLightPlaceX(parsed);
                            }}
                          />
                        </label>
                        <label>
                          {t('painter.placeAtTile.y')}
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, painterState.height - 1)}
                            step={1}
                            value={lightPlaceY}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (Number.isFinite(parsed)) setLightPlaceY(parsed);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            viewportRef.current?.placeLightAtTile(lightPlaceX, lightPlaceY)
                          }
                        >
                          {t('painter.placeAtTile')}
                        </button>
                      </div>
                      {floorLights.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">{t('painter.lights.emptyTitle')}</p>
                          <p className="ide-hint">{t('painter.lights.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list" aria-label={t('painter.lights')}>
                          {floorLights.map((light) => (
                            <li key={light.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  const brush = lightPlacementFromDocument(light);
                                  viewportRef.current?.setActiveLightKind(brush.kind);
                                  viewportRef.current?.setActiveLightColor(brush.color);
                                  viewportRef.current?.setActiveLightIntensity(brush.intensity);
                                  viewportRef.current?.setActiveLightRange(brush.range);
                                  viewportRef.current?.setActiveLightHeight(brush.height);
                                  viewportRef.current?.setTool('light');
                                  setStatusMessage(
                                    formatTemplate(t('painter.lights.reuseToast'), {
                                      id: light.id,
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.lights.summary'), {
                                  id: light.id,
                                  x: light.x ?? 0,
                                  y: light.y ?? 0,
                                  kind: light.kind,
                                  color: light.color,
                                })}
                              </button>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeLight(light.id)}
                              >
                                {t('painter.lights.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <h4 className="ide-section-title">{t('painter.lights.attached')}</h4>
                      <p className="ide-hint">{t('painter.lights.attached.hint')}</p>
                      <div className="painter-place-at-tile">
                        <label>
                          {t('painter.lights.attachTarget')}
                          <select
                            value={
                              attachTargets.includes(lightAttachTarget)
                                ? lightAttachTarget
                                : 'player'
                            }
                            onChange={(event) => setLightAttachTarget(event.target.value)}
                          >
                            {attachTargets.map((target) => (
                              <option key={target} value={target}>
                                {target === 'player'
                                  ? t('painter.lights.attach.player')
                                  : formatTemplate(t('painter.lights.attach.npc'), {
                                      id: target,
                                    })}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const target = attachTargets.includes(lightAttachTarget)
                              ? lightAttachTarget
                              : 'player';
                            viewportRef.current?.placeAttachedLight(target);
                            setStatusMessage(
                              formatTemplate(t('painter.lights.attached.toast'), {
                                attach: target,
                              }),
                            );
                          }}
                        >
                          {t('painter.lights.attach')}
                        </button>
                      </div>
                      {docAttachedLights.length === 0 ? (
                        <div className="ide-empty" role="status">
                          <p className="ide-empty-title">
                            {t('painter.lights.attached.emptyTitle')}
                          </p>
                          <p className="ide-hint">{t('painter.lights.attached.emptyBody')}</p>
                        </div>
                      ) : (
                        <ul className="ide-list" aria-label={t('painter.lights.attached')}>
                          {docAttachedLights.map((light) => (
                            <li key={light.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  const brush = lightPlacementFromDocument(light);
                                  viewportRef.current?.setActiveLightKind(brush.kind);
                                  viewportRef.current?.setActiveLightColor(brush.color);
                                  viewportRef.current?.setActiveLightIntensity(brush.intensity);
                                  viewportRef.current?.setActiveLightRange(brush.range);
                                  if (light.attach) setLightAttachTarget(light.attach);
                                  setStatusMessage(
                                    formatTemplate(t('painter.lights.reuseToast'), {
                                      id: light.id,
                                    }),
                                  );
                                }}
                              >
                                {formatTemplate(t('painter.lights.attached.summary'), {
                                  id: light.id,
                                  kind: light.kind,
                                  color: light.color,
                                  attach: light.attach ?? '',
                                })}
                              </button>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeLight(light.id)}
                              >
                                {t('painter.lights.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="ide-status">
        {mapReady && painterState ? (
          <span>
            {t(`painter.tool.${painterState.tool}`)} · L{painterState.activeLayer} · F
            {painterState.activeFloor}
            {hoverOverlay &&
              ` · ${formatTemplate(t('painter.status.hover'), {
                x: hoverOverlay.x,
                y: hoverOverlay.y,
              })}`}
          </span>
        ) : (
          <span>{t('painter.status.ready')}</span>
        )}
        {mapReady &&
          painterState &&
          (eventsValidationError !== null ? (
            <span className="ide-status-err">{t('painter.status.eventsInvalid')}</span>
          ) : (
            <span className="ide-status-ok">{t('painter.status.ready')}</span>
          ))}
        {statusMessage && <span className="ide-status-msg">{statusMessage}</span>}
      </footer>
    </div>
  );
}
