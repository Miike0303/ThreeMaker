/**
 * Pure `MapDocument` -> desktop-runtime-shape translator (loop-crear-jugar
 * design, "Translator home"). DOM/three-free: no Tauri fs, no texture
 * loading, and NOT wired into `main()`'s load path yet -- that wiring is a
 * later slice's job (`apps/desktop/src/authored-map.ts`). Mirrors the
 * editor's own `map-compose.ts` bridge (`toRenderableMap`/
 * `toRenderableTileset`) but targets this app's `FloorSource`/
 * `StairLinkRuntime` shapes (`floor-runtime.ts`) instead of the painter's.
 *
 * Per floor: builds an `RpgmMap`/`RpgmTileset` pair `buildChunks` already
 * understands, derives ramp cells via `@threemaker/map-format`'s
 * `deriveRampCells` (the same tile-id-scan `apps/editor/src/ramp-glyph.ts`
 * uses), and derives a room-id grid via `computeRoomIdGrid` when that floor
 * has any authored rooms (omitted otherwise, mirroring `rampCells`' "no
 * ramp" omission convention -- see `FloorSource`'s own doc comment).
 *
 * Stair-links and spawn reference floors by their stable string id
 * (`FloorDocument.id`); resolving that to a `floors` array index is this
 * app's job, not `@threemaker/gameplay`'s (see `apps/desktop/src/main.ts:537`'s
 * doc comment -- the original source of this contract, before `StairLinkRuntime`
 * moved to `floor-runtime.ts`). `resolveFloorIndex` below is the single place
 * that resolution happens.
 */

import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import type { FloorDocument, MapDocument, StairLinkDocument } from '@threemaker/map-format';
import { computeRoomIdGrid, deriveRampCells } from '@threemaker/map-format';
import type { FloorSource, StairLinkRuntime } from './floor-runtime.js';

/** Every RPGM sheet slot mapped to an empty name -- `sheetNames` is unused by the renderer's build pipeline (only caller-provided `sheetPixelSizes` matters, see `toDocTileset`'s doc comment), so this is a harmless placeholder, same as editor's `map-compose.ts`'s own `EMPTY_SHEET_NAMES`. Duplicated locally rather than imported cross-app -- see `apps/desktop/test/fixtures.ts`'s doc comment for the same cross-package-boundary rationale. */
const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

/**
 * Per-floor translator output: `FloorSource` minus the two fields this pure
 * function cannot populate (`textures`/`sheetPixelSizes` require async
 * texture loading over Tauri fs -- a later slice's job). References the
 * shared `FloorSource` contract via `Omit` rather than a hand-rolled
 * structural duplicate (loop-crear-jugar, Slice 2, "W4").
 */
export type TranslatedFloorSource = Omit<FloorSource, 'textures' | 'sheetPixelSizes'>;

/** Resolved player-spawn tile: a floor array index (not a string id) plus the tile position, `undefined` when the document authors no spawn. */
export interface TranslatedSpawn {
  readonly x: number;
  readonly y: number;
  readonly floorIndex: number;
}

/** Full translator output, consumed downstream by `createMapSession(floorSources, stairLinks, {spawn})` (a later slice's wiring -- see this module's own doc comment). */
export interface TranslatedMapDocument {
  readonly floorSources: readonly TranslatedFloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: TranslatedSpawn | undefined;
}

/** Bridges one floor's `MapLayers` to the `RpgmMap` shape `buildChunks` expects -- mirrors editor's `map-compose.ts`'s `toRenderableMap`, generalized to take the floor directly instead of a floor index into a single document. */
function toFloorMap(doc: MapDocument, floor: FloorDocument): RpgmMap {
  return {
    id: null,
    displayName: doc.name,
    width: doc.width,
    height: doc.height,
    tilesetId: 0,
    scrollType: 0,
    layers: {
      tileLayers: floor.layers.tiles,
      shadows: floor.layers.shadows,
      regions: floor.layers.regions,
    },
  };
}

/** Bridges a document's merged tileset flags to the `RpgmTileset` shape `buildChunks` expects -- mirrors editor's `map-compose.ts`'s `toRenderableTileset`. Shared across every floor (a document has exactly one tileset), same as the DEV demo's `tileset` reference being passed identically to every floor source. */
function toDocTileset(doc: MapDocument): RpgmTileset {
  return {
    id: 0,
    name: doc.name,
    sheetNames: EMPTY_SHEET_NAMES,
    flags: doc.tileset.flags,
  };
}

/** Resolves a `FloorDocument.id` reference to its position in `doc.floors` (array order = stacking order = `StairLinkRuntime`/spawn's numeric floor index). Throws on an unresolvable id -- `parseMapDocument`'s schema validation already guarantees every stair-link/spawn floor reference exists in a valid document, so this only ever fires on a document that skipped validation. */
function resolveFloorIndex(doc: MapDocument, floorId: string, context: string): number {
  const index = doc.floors.findIndex((floor) => floor.id === floorId);
  if (index === -1) {
    throw new Error(`${context}: no floor with id ${JSON.stringify(floorId)} in this document.`);
  }
  return index;
}

/** Resolves one `StairLinkDocument`'s string floor ids (`fromFloor`/`toFloor`/`waypoints[].floor`) to `StairLinkRuntime`'s numeric `floors` array indices. */
function translateStairLink(doc: MapDocument, link: StairLinkDocument): StairLinkRuntime {
  return {
    id: link.id,
    fromFloor: resolveFloorIndex(doc, link.fromFloor, `stairLinks[${link.id}].fromFloor`),
    toFloor: resolveFloorIndex(doc, link.toFloor, `stairLinks[${link.id}].toFloor`),
    bidirectional: link.bidirectional,
    waypoints: link.waypoints.map((waypoint) => ({
      x: waypoint.x,
      y: waypoint.y,
      floor: resolveFloorIndex(doc, waypoint.floor, `stairLinks[${link.id}].waypoints[].floor`),
    })),
  };
}

/** Translates one `FloorDocument` into its `TranslatedFloorSource` (map, tileset, ramp cells, and -- only when this floor has any authored rooms -- a room-id grid). */
function translateFloor(doc: MapDocument, floor: FloorDocument): TranslatedFloorSource {
  const rampCells = deriveRampCells(
    floor.layers.tiles,
    doc.tileset.semantics,
    doc.width,
    doc.height,
  );
  const hasRooms = doc.rooms.some((room) => room.floor === floor.id);

  return {
    floorId: floor.id,
    baseElevation: floor.baseElevation,
    map: toFloorMap(doc, floor),
    tileset: toDocTileset(doc),
    rampCells,
    ...(hasRooms
      ? { roomIdGrid: computeRoomIdGrid(doc.rooms, floor.id, doc.width, doc.height) }
      : {}),
  };
}

/** Resolves an authored `MapDocument.spawn` to its `TranslatedSpawn` (floor id -> array index), or `undefined` when the document authors none (spec: "missing spawn falls back silently" -- the runtime's own `findSpawnTile` fallback is the caller's job, not this pure translation step). */
function translateSpawn(doc: MapDocument): TranslatedSpawn | undefined {
  if (!doc.spawn) return undefined;
  return {
    x: doc.spawn.x,
    y: doc.spawn.y,
    floorIndex: resolveFloorIndex(doc, doc.spawn.floor, 'spawn.floor'),
  };
}

/**
 * Translates a valid `.tmmap` v3 `MapDocument` into desktop's runtime
 * shapes: one `TranslatedFloorSource` per floor (array order preserved,
 * matching `floors` stacking order), every `StairLinkDocument` resolved to
 * a `StairLinkRuntime`, and the authored spawn resolved (or `undefined`).
 * Pure -- same output for the same input, no IO, no three.js/DOM access.
 */
export function translateMapDocument(doc: MapDocument): TranslatedMapDocument {
  return {
    floorSources: doc.floors.map((floor) => translateFloor(doc, floor)),
    stairLinks: doc.stairLinks.map((link) => translateStairLink(doc, link)),
    spawn: translateSpawn(doc),
  };
}
