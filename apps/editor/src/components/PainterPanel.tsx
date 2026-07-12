import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument, SemanticClass } from '@threemaker/map-format';
import type { SheetPixelSize } from '@threemaker/renderer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type GameRow, getTileset, listGames, objectPreviewUrl } from '../catalog-client.js';
import { exportProject } from '../export-client.js';
import { formatTemplate } from '../format-template.js';
import { loadMapDocument, saveMapDocument } from '../map-client.js';
import { composeMapFromTilesets, seedDemoTiles } from '../map-compose.js';
import type { PainterState } from '../painter-store.js';
import type { RampGlyphOverlayItem, RoomOverlayItem } from '../painter-viewport.js';
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
  const [exporting, setExporting] = useState(false);
  const [rampGlyphs, setRampGlyphs] = useState<readonly RampGlyphOverlayItem[]>([]);
  const [roomOverlay, setRoomOverlay] = useState<readonly RoomOverlayItem[]>([]);

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

  const handleExport = useCallback(async () => {
    const doc = viewportRef.current?.currentDocument();
    if (!doc) return;
    setExporting(true);
    setStatusMessage(t('painter.exportRunning'));
    try {
      const result = await exportProject(doc);
      setStatusMessage(
        formatTemplate(t('painter.exportSuccess'), {
          outDir: result.outDir,
          marker: result.markerValueUsed,
        }),
      );
    } catch (err) {
      console.error('Failed to export the map:', err);
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage(formatTemplate(t('painter.exportFailed'), { message }));
    } finally {
      setExporting(false);
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
          <button type="button" disabled={exporting} onClick={handleExport}>
            {t('painter.export')}
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
      </div>
    </div>
  );
}
