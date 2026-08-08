import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument, NpcFacing, SemanticClass } from '@threemaker/map-format';
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
  loadCommunitySettings,
  maybeEnqueueCommunityShare,
  saveCommunitySettings,
} from '../community-settings.js';
import {
  canSavePainterDocument,
  defaultWorldSeedValue,
  parseWorldValue,
  type WorldValueKind,
  worldValueKind,
} from '../event-form-helpers.js';
import { formatTemplate } from '../format-template.js';
import { GlbIngestError, type GlbIngestFs, ingestGlbBytes } from '../glb-ingest.js';
import { loadMapDocument, saveMapDocument } from '../map-client.js';
import { composeMapFromTilesets, seedDemoTiles } from '../map-compose.js';
import { isEventReferenced, type PainterState, validateEventsDraft } from '../painter-store.js';
import type {
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
];

/** Paint layer roles for 2.5D authoring (schema indices 0–3, RPG Maker–style). */
const PAINT_LAYERS = [
  { index: 0 as const, nameKey: 'painter.layer.ground' },
  { index: 1 as const, nameKey: 'painter.layer.mid' },
  { index: 2 as const, nameKey: 'painter.layer.wall' },
  { index: 3 as const, nameKey: 'painter.layer.over' },
] as const;

/** Which inspector tab to open when a tool is selected (studio routing). */
function inspectorTabForTool(tool: ToolId): 'map' | 'paint' | 'events' | 'ink' | 'entities' {
  switch (tool) {
    case 'room-box':
    case 'stair-link':
    case 'spawn-point':
      return 'map';
    case 'prop':
    case 'npc':
    case 'trigger':
      return 'entities';
    default:
      return 'paint';
  }
}

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
  const [characterSprites, setCharacterSprites] = useState<readonly AssetRow[]>([]);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  // Coordinate placement (complements canvas clicks on large maps).
  const [propPlaceX, setPropPlaceX] = useState(0);
  const [propPlaceY, setPropPlaceY] = useState(0);
  const [npcPlaceX, setNpcPlaceX] = useState(0);
  const [npcPlaceY, setNpcPlaceY] = useState(0);
  const [triggerPlaceX, setTriggerPlaceX] = useState(0);
  const [triggerPlaceY, setTriggerPlaceY] = useState(0);
  // Events section UI (events editor WU-02).
  const [selectedEventKey, setSelectedEventKey] = useState<string | undefined>(undefined);
  const [newEventKey, setNewEventKey] = useState('');
  const [newWorldSeedKey, setNewWorldSeedKey] = useState('');
  const [newWorldSeedKind, setNewWorldSeedKind] = useState<WorldValueKind>('boolean');
  const [inspectorTab, setInspectorTab] = useState<'map' | 'paint' | 'events' | 'ink' | 'entities'>(
    'paint',
  );
  const [community, setCommunity] = useState<CommunitySettings>(() => loadCommunitySettings());
  /** Procgen seed (uint32). Editable; randomize button rolls a new one. */
  const [procgenSeed, setProcgenSeed] = useState(() => (Date.now() >>> 0) % 1_000_000_000);

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
      const enqueue = maybeEnqueueCommunityShare(community, {
        mapId: doc.id,
        mapName: doc.name,
        tileObjectShas: tileShas,
        // Until provenance is on slots, treat non-empty catalog slots as possibly imported.
        usesOnlyImportedAssets: false,
      });
      if (enqueue) {
        console.info('[Maker Studio] community share queued (offline stub)', enqueue);
        setStatusMessage(t('painter.saveSuccessShareQueued'));
      } else {
        setStatusMessage(t('painter.saveSuccess'));
      }
    } catch (err) {
      console.error('Failed to save the map:', err);
      setStatusMessage(t('painter.saveFailed'));
    }
  }, [t, community]);

  const handleGenerateDungeon = useCallback(async () => {
    const viewport = viewportRef.current;
    const doc = viewport?.currentDocument();
    const state = viewport?.painterState;
    if (!viewport || !doc || !state) {
      setStatusMessage(t('painter.procgen.needMap'));
      return;
    }
    try {
      const floor0 = doc.floors[0];
      const groundLayer = floor0?.layers.tiles[0] ?? [];
      const wallLayer = floor0?.layers.tiles[2] ?? [];
      const { groundTileId, wallTileId } = resolveDungeonTileIds({
        fillTileId: state.fillTileId,
        groundLayer,
        wallLayer,
        fallbackGround: GROUND_TILE_ID,
        // A4 wall range start — only used when the map has no wall majority yet.
        fallbackWall: 4352,
      });
      const seed = procgenSeed >>> 0;
      const stamp = stampSimpleDungeon({
        width: doc.width,
        height: doc.height,
        seed,
        groundTileId,
        wallTileId,
        roomCount: 6,
      });
      // Stamp only rewrites floor-0 tile layers — events/NPCs/spawn stay on the document.
      const stamped = applyDungeonStampToMapDocument(doc, stamp);
      const { textures, sheetPixelSizes } = await loadSlotTextures(stamped);
      viewport.loadMap(stamped, textures, sheetPixelSizes, groundTileId);
      setPaletteSlots(await buildPaletteSlots(stamped, sheetPixelSizes));
      setMapReady(true);
      setStatusMessage(
        formatTemplate(t('painter.procgen.success'), {
          rooms: stamp.rooms.length,
          seed: stamp.seed,
        }),
      );
    } catch (err) {
      console.error('Dungeon procgen failed:', err);
      setStatusMessage(t('painter.procgen.failed'));
    }
  }, [t, procgenSeed]);

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
  };

  const INSPECTOR_TABS = ['map', 'paint', 'events', 'ink', 'entities'] as const;

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
                onClick={() => setProcgenSeed((Math.random() * 1_000_000_000) >>> 0)}
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
              {paletteSlots.map((paletteSlot) => (
                <TilePalette
                  key={paletteSlot.slot}
                  label={formatTemplate(t('painter.paletteFor'), { slot: paletteSlot.slot })}
                  sheet={paletteSlot.slot}
                  imageUrl={paletteSlot.imageUrl}
                  pixelSize={paletteSlot.pixelSize}
                  tilePixelSize={paletteSlot.tilePixelSize}
                  selectedTileId={painterState.fillTileId}
                  onSelect={(tileId) => viewportRef.current?.setFillTileId(tileId)}
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
                      <ul className="ide-list">
                        {painterState.rooms
                          .filter(
                            (room) =>
                              room.floor === painterState.floors[painterState.activeFloor]?.id,
                          )
                          .map((room) => (
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
                    </section>

                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.stairLinks')}</h3>
                      {painterState.pendingStairEntry && (
                        <p className="ide-hint">{t('painter.stairLink.pendingHint')}</p>
                      )}
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
                        <button
                          type="button"
                          onClick={() => setProcgenSeed((Math.random() * 1_000_000_000) >>> 0)}
                        >
                          {t('painter.procgen.randomizeSeed')}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void handleGenerateDungeon()}
                        >
                          {t('painter.procgen.generate')}
                        </button>
                      </div>
                    </section>
                    <section className="ide-section">
                      <h3 className="ide-section-title">{t('painter.community')}</h3>
                      <p className="ide-hint">{t('painter.community.hint')}</p>
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
                      <ul className="ide-list">
                        {painterState.props
                          .filter(
                            (prop) =>
                              prop.floor === painterState.floors[painterState.activeFloor]?.id,
                          )
                          .map((prop) => (
                            <li key={prop.id}>
                              <span>
                                {formatTemplate(t('painter.props.summary'), {
                                  id: prop.id,
                                  x: prop.x,
                                  y: prop.y,
                                })}
                              </span>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeProp(prop.id)}
                              >
                                {t('painter.props.remove')}
                              </button>
                            </li>
                          ))}
                      </ul>
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
                      <ul className="ide-list">
                        {painterState.npcs
                          .filter(
                            (npc) =>
                              npc.floor === painterState.floors[painterState.activeFloor]?.id,
                          )
                          .map((npc) => (
                            <li key={npc.id}>
                              <span>
                                {formatTemplate(t('painter.npcs.summary'), {
                                  id: npc.id,
                                  x: npc.x,
                                  y: npc.y,
                                  event: npc.onInteract,
                                })}
                              </span>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeNpc(npc.id)}
                              >
                                {t('painter.npcs.remove')}
                              </button>
                            </li>
                          ))}
                      </ul>
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
                      <ul className="ide-list">
                        {painterState.triggers
                          .filter(
                            (trigger) =>
                              trigger.floor === painterState.floors[painterState.activeFloor]?.id,
                          )
                          .map((trigger) => (
                            <li key={trigger.id}>
                              <span>
                                {formatTemplate(t('painter.triggers.summary'), {
                                  id: trigger.id,
                                  x: trigger.x,
                                  y: trigger.y,
                                  on: trigger.on,
                                  event: trigger.event,
                                })}
                              </span>
                              <button
                                type="button"
                                onClick={() => viewportRef.current?.removeTrigger(trigger.id)}
                              >
                                {t('painter.triggers.remove')}
                              </button>
                            </li>
                          ))}
                      </ul>
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
