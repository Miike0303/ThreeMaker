import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument, SemanticClass } from '@threemaker/map-format';
import type { SheetPixelSize } from '@threemaker/renderer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type GameRow, getTileset, listGames, objectPreviewUrl } from '../catalog-client.js';
import { formatTemplate } from '../format-template.js';
import { loadMapDocument, saveMapDocument } from '../map-client.js';
import { composeMapFromTilesets, seedDemoTiles } from '../map-compose.js';
import type { PainterState } from '../painter-store.js';
import type {
  RampGlyphOverlayItem,
  RoomOverlayItem,
  SpawnOverlayItem,
  StairOverlayItem,
} from '../painter-viewport.js';
import { loadSlotTextures, PainterViewport } from '../painter-viewport.js';
import { RAMP_DIRECTION_ARROW } from '../ramp-glyph.js';
import type { ToolId } from '../tool-sm.js';
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
];

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
    slots.push({ slot, imageUrl, pixelSize });
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

  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((err) => console.error('Failed to load games for the painter:', err));
  }, []);

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
    });
    viewportRef.current = viewport;
    return () => {
      viewport.dispose();
      viewportRef.current = null;
    };
  }, []);

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
      setPaletteSlots(await buildPaletteSlots(doc, sheetPixelSizes));
      setMapReady(true);
    } catch (err) {
      console.error('Failed to create the painter demo map:', err);
      setStatusMessage(t('painter.createFailed'));
    }
  }, [tilesetAId, tilesetBId, t]);

  const handleSave = useCallback(async () => {
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

  const handleLoad = useCallback(async () => {
    try {
      const doc = await loadMapDocument();
      if (!doc) {
        setStatusMessage(t('painter.loadEmpty'));
        return;
      }
      const { textures, sheetPixelSizes } = await loadSlotTextures(doc);
      viewportRef.current?.loadMap(doc, textures, sheetPixelSizes, GROUND_TILE_ID);
      setPaletteSlots(await buildPaletteSlots(doc, sheetPixelSizes));
      setMapReady(true);
      setStatusMessage(t('painter.loadSuccess'));
    } catch (err) {
      console.error('Failed to load the map:', err);
      setStatusMessage(t('painter.loadFailed'));
    }
  }, [t]);

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

      {mapReady && painterState && paletteSlots.length > 0 && (
        <div className="painter-palettes">
          {paletteSlots.map((paletteSlot) => (
            <TilePalette
              key={paletteSlot.slot}
              label={formatTemplate(t('painter.paletteFor'), { slot: paletteSlot.slot })}
              sheet={paletteSlot.slot}
              imageUrl={paletteSlot.imageUrl}
              pixelSize={paletteSlot.pixelSize}
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
      </div>
    </div>
  );
}
