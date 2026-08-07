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
import { RAMP_DIRECTION_ARROW } from '../ramp-glyph.js';
import type { ToolId } from '../tool-sm.js';
import { CommandList } from './CommandForm.js';
import { GameTilesetPicker } from './GameTilesetPicker.js';
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
      setStatusMessage(t('painter.saveSuccess'));
    } catch (err) {
      console.error('Failed to save the map:', err);
      setStatusMessage(t('painter.saveFailed'));
    }
  }, [t]);

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

  return (
    <div className="painter-panel">
      <div className="painter-setup">
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
        <button
          type="button"
          disabled={tilesetAId === undefined || tilesetBId === undefined}
          onClick={handleCreateMap}
        >
          {t('painter.createMap')}
        </button>
        <button type="button" onClick={handleLoad}>
          {t('painter.load')}
        </button>
      </div>

      {mapReady && painterState && (
        <div className="painter-floor-switcher">
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
          <button type="button" onClick={() => viewportRef.current?.addFloor(crypto.randomUUID())}>
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
      )}

      {mapReady && painterState && (
        <div className="painter-toolbar">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={painterState.tool === tool.id ? 'painter-tool-active' : undefined}
              onClick={() => viewportRef.current?.setTool(tool.id)}
            >
              {t(`painter.tool.${tool.id}`)} ({tool.shortcut})
            </button>
          ))}

          <label>
            {t('painter.layer')}
            <select
              value={painterState.activeLayer}
              onChange={(event) =>
                viewportRef.current?.setActiveLayer(Number(event.target.value) as 0 | 1 | 2 | 3)
              }
            >
              {[0, 1, 2, 3].map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </label>

          <label className="painter-advanced-fill">
            {t('painter.advancedFillTileId')}
            <input
              type="number"
              value={painterState.fillTileId}
              onChange={(event) => viewportRef.current?.setFillTileId(Number(event.target.value))}
            />
          </label>

          <button type="button" onClick={() => viewportRef.current?.undo()}>
            {t('painter.undo')}
          </button>
          <button type="button" onClick={() => viewportRef.current?.redo()}>
            {t('painter.redo')}
          </button>

          <label>
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

          <button type="button" onClick={handleSave}>
            {t('painter.save')}
          </button>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-rooms">
          <div className="painter-rooms-toolbar">
            <span className="painter-rooms-heading">{t('painter.rooms')}</span>
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
          <ul className="painter-room-list">
            {painterState.rooms
              .filter((room) => room.floor === painterState.floors[painterState.activeFloor]?.id)
              .map((room) => (
                <li
                  key={room.id}
                  className={
                    painterState.activeRoomId === room.id ? 'painter-room-active' : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      viewportRef.current?.setActiveRoomId(room.id);
                      viewportRef.current?.setTool('room-box');
                    }}
                  >
                    {room.name ?? formatTemplate(t('painter.room.unnamed'), { id: room.id })}
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
                  <button type="button" onClick={() => viewportRef.current?.removeRoom(room.id)}>
                    {t('painter.room.remove')}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-stair-links">
          <span className="painter-stair-links-heading">{t('painter.stairLinks')}</span>
          {painterState.pendingStairEntry && (
            <p className="painter-stair-link-pending-hint">{t('painter.stairLink.pendingHint')}</p>
          )}
          <ul className="painter-stair-link-list">
            {painterState.stairLinks.map((link) => (
              <li key={link.id}>
                <span>
                  {formatTemplate(t('painter.stairLink.summary'), {
                    from: resolveFloorLabel(painterState.floors, link.fromFloor, t),
                    to: resolveFloorLabel(painterState.floors, link.toFloor, t),
                  })}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={link.bidirectional}
                    onChange={() => viewportRef.current?.toggleStairLinkBidirectional(link.id)}
                  />
                  {t('painter.stairLink.bidirectional')}
                </label>
                <button type="button" onClick={() => viewportRef.current?.removeStairLink(link.id)}>
                  {t('painter.stairLink.remove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-spawn">
          <span className="painter-spawn-heading">{t('painter.spawn')}</span>
          {painterState.spawn ? (
            <>
              <span>
                {formatTemplate(t('painter.spawn.summary'), {
                  floor: resolveFloorLabel(painterState.floors, painterState.spawn.floor, t),
                  x: painterState.spawn.x,
                  y: painterState.spawn.y,
                })}
              </span>
              <button type="button" onClick={() => viewportRef.current?.clearSpawn()}>
                {t('painter.spawn.clear')}
              </button>
            </>
          ) : (
            <span>{t('painter.spawn.notSet')}</span>
          )}
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-props">
          {/* Scale/rotation/animation stay JSON-side this WU (C5 WU-04 minimal). */}
          <span className="painter-props-heading">{t('painter.props')}</span>
          <label>
            {t('painter.props.pickGlb')}
            <input ref={glbInputRef} type="file" accept=".glb" onChange={handleGlbFile} />
          </label>
          <span>
            {painterState.activePropObject
              ? formatTemplate(t('painter.props.currentObject'), {
                  sha: shortSha(painterState.activePropObject),
                })
              : t('painter.props.noObject')}
          </span>
          {!painterState.activePropObject && painterState.tool === 'prop' && (
            <p className="painter-props-hint">{t('painter.props.selectHint')}</p>
          )}
          {/* Explicit place-at-tile: does NOT require the prop tool to be active. */}
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
              onClick={() => viewportRef.current?.placePropAtTile(propPlaceX, propPlaceY)}
            >
              {t('painter.placeAtTile')}
            </button>
          </div>
          <ul className="painter-prop-list">
            {painterState.props
              .filter((prop) => prop.floor === painterState.floors[painterState.activeFloor]?.id)
              .map((prop) => (
                <li key={prop.id}>
                  <span>
                    {formatTemplate(t('painter.props.summary'), {
                      id: prop.id,
                      x: prop.x,
                      y: prop.y,
                    })}
                  </span>
                  <button type="button" onClick={() => viewportRef.current?.removeProp(prop.id)}>
                    {t('painter.props.remove')}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-events">
          <span className="painter-events-heading">{t('painter.events')}</span>
          {eventsValidationError !== null && (
            <p className="painter-events-validation-error" role="alert">
              {eventsValidationError}
            </p>
          )}
          <div className="painter-events-keys">
            <ul className="painter-events-key-list">
              {painterState.eventKeys.map((key) => {
                const referenced = isEventReferenced(painterState, key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={
                        key === selectedEventKey ? 'painter-events-key-selected' : undefined
                      }
                      onClick={() => setSelectedEventKey(key)}
                    >
                      {key}
                    </button>
                    <button
                      type="button"
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
          </div>

          {selectedEventKey !== undefined && painterState.events[selectedEventKey] !== undefined ? (
            <div className="painter-events-script">
              <span className="painter-events-script-heading">
                {formatTemplate(t('painter.events.commandsFor'), { key: selectedEventKey })}
              </span>
              <CommandList
                t={t}
                basePath={[]}
                commands={painterState.events[selectedEventKey] ?? []}
                onUpdate={(path, patch) =>
                  viewportRef.current?.updateCommand(selectedEventKey, path, patch)
                }
                onRemove={(path) => viewportRef.current?.removeCommand(selectedEventKey, path)}
                onMove={(path, delta) =>
                  viewportRef.current?.moveCommand(selectedEventKey, path, delta)
                }
                onAdd={(path, kind) =>
                  viewportRef.current?.addCommand(selectedEventKey, path, kind)
                }
              />
            </div>
          ) : (
            <p className="painter-events-hint">{t('painter.events.noSelection')}</p>
          )}

          <div className="painter-events-world-seeds">
            <span className="painter-events-world-seeds-heading">
              {t('painter.events.worldSeeds')}
            </span>
            <ul className="painter-events-world-seed-list">
              {Object.entries(painterState.worldSeeds).map(([key, value]) => {
                const kind = worldValueKind(value);
                return (
                  <li key={key}>
                    <span className="painter-events-world-seed-key">{key}</span>
                    <label>
                      {t('painter.events.worldValueType')}
                      <select
                        value={kind}
                        onChange={(event) => {
                          const next = event.target.value as WorldValueKind;
                          viewportRef.current?.setWorldSeed(key, defaultWorldSeedValue(next));
                        }}
                      >
                        <option value="boolean">
                          {t('painter.events.worldValueType.boolean')}
                        </option>
                        <option value="number">{t('painter.events.worldValueType.number')}</option>
                        <option value="string">{t('painter.events.worldValueType.string')}</option>
                      </select>
                    </label>
                    {kind === 'boolean' ? (
                      <label>
                        {t('painter.events.field.value')}
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) =>
                            viewportRef.current?.setWorldSeed(key, event.target.checked)
                          }
                        />
                      </label>
                    ) : kind === 'number' ? (
                      <label>
                        {t('painter.events.field.value')}
                        <input
                          type="number"
                          value={typeof value === 'number' ? value : 0}
                          onChange={(event) =>
                            viewportRef.current?.setWorldSeed(
                              key,
                              parseWorldValue('number', event.target.value),
                            )
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        {t('painter.events.field.value')}
                        <input
                          type="text"
                          value={typeof value === 'string' ? value : String(value)}
                          onChange={(event) =>
                            viewportRef.current?.setWorldSeed(key, event.target.value)
                          }
                        />
                      </label>
                    )}
                    <button type="button" onClick={() => viewportRef.current?.removeWorldSeed(key)}>
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
                onChange={(event) => setNewWorldSeedKind(event.target.value as WorldValueKind)}
                aria-label={t('painter.events.worldValueType')}
              >
                <option value="boolean">{t('painter.events.worldValueType.boolean')}</option>
                <option value="number">{t('painter.events.worldValueType.number')}</option>
                <option value="string">{t('painter.events.worldValueType.string')}</option>
              </select>
              <button
                type="button"
                disabled={newWorldSeedKey.trim() === ''}
                onClick={() => {
                  const key = newWorldSeedKey.trim();
                  if (key === '') return;
                  viewportRef.current?.setWorldSeed(key, defaultWorldSeedValue(newWorldSeedKind));
                  setNewWorldSeedKey('');
                }}
              >
                {t('painter.events.worldSeeds.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-npcs">
          {/* Routine editing stays JSON-side (c1a follow-up minimal). Event
              scripts are authored in the Events section above. */}
          <span className="painter-npcs-heading">{t('painter.npcs')}</span>
          <p className="painter-npcs-events-hint">{t('painter.npcs.eventsHint')}</p>
          {painterState.eventKeys.length === 0 && (
            <p className="painter-npcs-hint">{t('painter.npcs.noEventsHint')}</p>
          )}
          <label>
            {t('painter.npcs.sprite')}
            <select
              name="npc-sprite"
              value={painterState.activeNpcSpriteObject ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                viewportRef.current?.setActiveNpcSpriteObject(value === '' ? undefined : value);
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
                viewportRef.current?.setActiveNpcFacing(event.target.value as NpcFacing)
              }
            >
              {NPC_FACINGS.map((facing) => (
                <option key={facing} value={facing}>
                  {t(`painter.npcs.facing.${facing}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('painter.npcs.event')}
            <select
              name="npc-event"
              value={painterState.activeNpcEventKey ?? ''}
              disabled={painterState.eventKeys.length === 0}
              onChange={(event) => {
                const value = event.target.value;
                viewportRef.current?.setActiveNpcEventKey(value === '' ? undefined : value);
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
          {!painterState.activeNpcSpriteObject && painterState.tool === 'npc' && (
            <p className="painter-npcs-hint">{t('painter.npcs.selectSpriteHint')}</p>
          )}
          {/* Explicit place-at-tile: does NOT require the npc tool to be active. */}
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
                painterState.eventKeys.length === 0 ||
                !painterState.activeNpcSpriteObject ||
                !painterState.activeNpcEventKey
              }
              onClick={() => viewportRef.current?.placeNpcAtTile(npcPlaceX, npcPlaceY)}
            >
              {t('painter.placeAtTile')}
            </button>
          </div>
          <ul className="painter-npc-list">
            {painterState.npcs
              .filter((npc) => npc.floor === painterState.floors[painterState.activeFloor]?.id)
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
                  <button type="button" onClick={() => viewportRef.current?.removeNpc(npc.id)}>
                    {t('painter.npcs.remove')}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {mapReady && painterState && (
        <div className="painter-triggers">
          {/* Event scripts are authored in the Events section above. */}
          <span className="painter-triggers-heading">{t('painter.triggers')}</span>
          <p className="painter-triggers-events-hint">{t('painter.triggers.eventsHint')}</p>
          {painterState.eventKeys.length === 0 && (
            <p className="painter-triggers-hint">{t('painter.triggers.noEventsHint')}</p>
          )}
          <fieldset className="painter-triggers-on">
            <legend>{t('painter.triggers.on')}</legend>
            <label>
              <input
                type="radio"
                name="trigger-on"
                checked={painterState.activeTriggerOn === 'enter'}
                onChange={() => viewportRef.current?.setActiveTriggerOn('enter')}
              />
              {t('painter.triggers.on.enter')}
            </label>
            <label>
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
                viewportRef.current?.setActiveTriggerEventKey(value === '' ? undefined : value);
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
          {/* Explicit place-at-tile: does NOT require the trigger tool to be active. */}
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
              disabled={painterState.eventKeys.length === 0 || !painterState.activeTriggerEventKey}
              onClick={() => viewportRef.current?.placeTriggerAtTile(triggerPlaceX, triggerPlaceY)}
            >
              {t('painter.placeAtTile')}
            </button>
          </div>
          <ul className="painter-trigger-list">
            {painterState.triggers
              .filter(
                (trigger) => trigger.floor === painterState.floors[painterState.activeFloor]?.id,
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
        </div>
      )}

      {mapReady && painterState && paletteSlots.length > 0 && (
        <div className="painter-palettes">
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
              tileAriaLabel={(tileId) => formatTemplate(t('painter.paletteTile'), { id: tileId })}
            />
          ))}
        </div>
      )}

      {statusMessage && <p className="painter-status">{statusMessage}</p>}

      <div className="painter-viewport-wrapper" style={{ position: 'relative' }}>
        <div ref={containerRef} className="painter-viewport-canvas" />
        {rampGlyphs.length > 0 && (
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
        {roomOverlay.length > 0 && (
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
              // The marker's aria-label names the OTHER end of the link -- an
              // entry marker (on fromFloor) says where it leads TO, an exit
              // marker (on toFloor) says where it came FROM.
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
        {spawnOverlay && (
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
        {propOverlay.length > 0 && (
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
                aria-label={formatTemplate(t('painter.props.overlayLabel'), { id: point.id })}
              >
                ◆
              </span>
            ))}
          </div>
        )}
        {npcOverlay.length > 0 && (
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
                aria-label={formatTemplate(t('painter.npcs.overlayLabel'), { id: point.id })}
              >
                ☺
              </span>
            ))}
          </div>
        )}
        {triggerOverlay.length > 0 && (
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
                aria-label={formatTemplate(t('painter.triggers.overlayLabel'), { id: point.id })}
              >
                ◎
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
