import type { SemanticClass } from '@threemaker/map-format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type GameRow, getTileset, listGames, listTilesetsForGame } from '../catalog-client.js';
import { loadMapDocument, saveMapDocument } from '../map-client.js';
import { composeMapFromTilesets, seedDemoTiles } from '../map-compose.js';
import type { PainterState } from '../painter-store.js';
import { loadSlotTextures, PainterViewport } from '../painter-viewport.js';
import type { ToolId } from '../tool-sm.js';

export interface PainterPanelProps {
  readonly t: (key: string) => string;
}

interface TilesetOption {
  readonly id: number;
  readonly label: string;
}

const TOOLS: readonly { readonly id: ToolId; readonly shortcut: string }[] = [
  { id: 'brush', shortcut: 'B' },
  { id: 'box-fill', shortcut: 'U' },
  { id: 'flood-fill', shortcut: 'G' },
  { id: 'eyedropper', shortcut: 'I' },
];

const SEMANTIC_CLASSES: readonly SemanticClass[] = ['none', 'wall', 'door', 'window', 'furniture'];

const DEMO_MAP_WIDTH = 20;
const DEMO_MAP_HEIGHT = 15;
/** First A2 autotile id (kind 0, shape 0) -- a valid, always-populated ground tile for any properly-formed A2 sheet. */
const GROUND_TILE_ID = 2816;
/** B-sheet local index 1 (id 0 on the B sheet is treated as "empty" everywhere in this codebase, so the demo seed uses id 1 instead). */
const DECOR_TILE_ID = 1;

/**
 * Painter: compose a map from two different games' tilesets (one slot each),
 * then paint it with brush/box-fill/flood-fill/eyedropper, undo/redo, and
 * semantic-class mode. All catalog IO goes through `catalog-client.ts`; all
 * painting logic goes through `painter-viewport.ts` (imperative,
 * untested) -> `painter-store.ts` (pure, tested). This component owns only
 * UI/selection state, left untested per this repo's convention.
 */
export function PainterPanel({ t }: PainterPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PainterViewport | null>(null);

  const [games, setGames] = useState<readonly GameRow[]>([]);
  const [gameAId, setGameAId] = useState<number | undefined>(undefined);
  const [gameBId, setGameBId] = useState<number | undefined>(undefined);
  const [tilesetsA, setTilesetsA] = useState<readonly TilesetOption[]>([]);
  const [tilesetsB, setTilesetsB] = useState<readonly TilesetOption[]>([]);
  const [tilesetAId, setTilesetAId] = useState<number | undefined>(undefined);
  const [tilesetBId, setTilesetBId] = useState<number | undefined>(undefined);

  const [mapReady, setMapReady] = useState(false);
  const [painterState, setPainterState] = useState<PainterState | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((err) => console.error('Failed to load games for the painter:', err));
  }, []);

  useEffect(() => {
    if (gameAId === undefined) {
      setTilesetsA([]);
      return;
    }
    listTilesetsForGame(gameAId)
      .then((rows) =>
        setTilesetsA(rows.map((row) => ({ id: row.id, label: row.name ?? `#${row.id}` }))),
      )
      .catch((err) => console.error('Failed to load tilesets for game A:', err));
  }, [gameAId]);

  useEffect(() => {
    if (gameBId === undefined) {
      setTilesetsB([]);
      return;
    }
    listTilesetsForGame(gameBId)
      .then((rows) =>
        setTilesetsB(rows.map((row) => ({ id: row.id, label: row.name ?? `#${row.id}` }))),
      )
      .catch((err) => console.error('Failed to load tilesets for game B:', err));
  }, [gameBId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = new PainterViewport(container, {
      onStateChange: setPainterState,
      onPicked: (tileId) => viewport.setFillTileId(tileId),
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
        composeMapFromTilesets(crypto.randomUUID(), 'Demo Map', DEMO_MAP_WIDTH, DEMO_MAP_HEIGHT, [
          { slot: 'A2', tileset: tilesetA },
          { slot: 'B', tileset: tilesetB },
        ]),
        GROUND_TILE_ID,
        DECOR_TILE_ID,
      );
      const { textures, sheetPixelSizes } = await loadSlotTextures(doc);
      viewportRef.current?.loadMap(doc, textures, sheetPixelSizes, GROUND_TILE_ID);
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
        <label>
          {t('painter.gameA')}
          <select
            value={gameAId ?? ''}
            onChange={(event) =>
              setGameAId(event.target.value ? Number(event.target.value) : undefined)
            }
          >
            <option value="">{t('painter.selectGame')}</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title ?? game.rootPath}
              </option>
            ))}
          </select>
          <select
            value={tilesetAId ?? ''}
            onChange={(event) =>
              setTilesetAId(event.target.value ? Number(event.target.value) : undefined)
            }
            disabled={tilesetsA.length === 0}
          >
            <option value="">{t('painter.selectTileset')}</option>
            {tilesetsA.map((tileset) => (
              <option key={tileset.id} value={tileset.id}>
                {tileset.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('painter.gameB')}
          <select
            value={gameBId ?? ''}
            onChange={(event) =>
              setGameBId(event.target.value ? Number(event.target.value) : undefined)
            }
          >
            <option value="">{t('painter.selectGame')}</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title ?? game.rootPath}
              </option>
            ))}
          </select>
          <select
            value={tilesetBId ?? ''}
            onChange={(event) =>
              setTilesetBId(event.target.value ? Number(event.target.value) : undefined)
            }
            disabled={tilesetsB.length === 0}
          >
            <option value="">{t('painter.selectTileset')}</option>
            {tilesetsB.map((tileset) => (
              <option key={tileset.id} value={tileset.id}>
                {tileset.label}
              </option>
            ))}
          </select>
        </label>
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

          <label>
            {t('painter.fillTileId')}
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

      {statusMessage && <p className="painter-status">{statusMessage}</p>}

      <div ref={containerRef} className="painter-viewport-canvas" />
    </div>
  );
}
