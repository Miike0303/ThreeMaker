/**
 * Composes a fresh `MapDocument` from catalog tileset sources (Slice 4's
 * per-slot multi-tileset model) and bridges it to the shapes
 * `@threemaker/renderer`'s `buildChunks` already understands. Pure.
 *
 * Plantas Apiladas (Slice 4, painter-floors): genuinely floor-aware --
 * `painterFloorsFromDocument`/`composeDocumentFromPainterFloors` bridge a
 * v2 `MapDocument`'s `floors[]` to/from the painter store's per-floor
 * state, and `toRenderableMap` takes an explicit floor index. This
 * replaces Slice 1's transitional `primaryFloorLayers`/
 * `withPrimaryFloorLayers` single-floor accessors (still exported from
 * `@threemaker/map-format` for other, not-yet-floor-aware consumers).
 */

import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import type {
  FloorDocument,
  LightDocument,
  MapDocument,
  MapLayers,
  MapSpawn,
  NpcDocument,
  PropDocument,
  RoomDocument,
  SlotComposition,
  StairLinkDocument,
  TileLayerSet,
  TileSheetSlot,
  TriggerDocument,
} from '@threemaker/map-format';
import { createBlankMapDocument } from '@threemaker/map-format';
import { pruneLightsForNpcs } from './entity-lists.js';

/**
 * RPGM tile-id range `[start, end)` per sheet slot -- duplicates
 * `packages/importer-rpgm/src/tile-id.ts`'s private `SHEET_RANGES` table
 * (not exported from that package), since a slot's flags only ever cover
 * its own id range.
 */
const SLOT_ID_RANGES: Readonly<Record<TileSheetSlot, readonly [number, number]>> = {
  B: [0, 256],
  C: [256, 512],
  D: [512, 768],
  E: [768, 1024],
  A5: [1536, 2048],
  A1: [2048, 2816],
  A2: [2816, 4352],
  A3: [4352, 5888],
  A4: [5888, 8192],
};

const FLAGS_LENGTH = 8192;

/** Every Nth cell of the demo decor layer gets a decor tile -- an arbitrary sparse pattern (not derived from any tileset data) that just needs to look scattered, not uniform, for a first paintable demo map. */
const DECOR_SPACING = 7;

export interface SlotSourceFlags {
  readonly slot: TileSheetSlot;
  /** The full flags array of the source tileset this slot is composed from (only its own id range is actually used). */
  readonly sourceFlags: readonly number[];
}

/** Merges each slot's own id-range slice from its source tileset's flags array into one composed array; unset slots' ranges stay 0. */
export function mergeSlotFlags(sources: readonly SlotSourceFlags[]): number[] {
  const merged = new Array(FLAGS_LENGTH).fill(0);
  for (const source of sources) {
    const [start, end] = SLOT_ID_RANGES[source.slot];
    for (let i = start; i < end; i++) {
      merged[i] = source.sourceFlags[i] ?? 0;
    }
  }
  return merged;
}

export type { CreateBlankMapDocumentOptions } from '@threemaker/map-format';
export { createBlankMapDocument } from '@threemaker/map-format';

/** Default display name when the author clears the map name field (WU-UX-09). */
export const DEFAULT_MAP_NAME = 'Untitled Map';

/**
 * Trim map display name for save/export. Empty / whitespace-only → `fallback`
 * (schema allows `""`, but Maker Studio refuses blank titles in the UI).
 */
export function normalizeMapName(raw: string, fallback: string = DEFAULT_MAP_NAME): string {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

/**
 * Seeds a freshly-created blank map with real tile ids from its composed
 * slots, so there is something to eyedrop/brush/fill/undo immediately.
 * Only ever called on a just-created (single-floor) blank document, so it
 * seeds floor 0 directly. ponytail: a full clickable tileset-image palette
 * is out of scope this slice (see apply-progress); eyedropper-first is the
 * primary tile-selection workflow, with these seeded tiles as the starting
 * material.
 */
export function seedDemoTiles(
  doc: MapDocument,
  groundTileId: number,
  decorTileId: number,
): MapDocument {
  const floor = doc.floors[0];
  if (!floor) return doc;
  const tiles = floor.layers.tiles.map((layer) => layer.slice()) as [
    number[],
    number[],
    number[],
    number[],
  ];
  const groundLayer = tiles[0];
  for (let i = 0; i < groundLayer.length; i++) groundLayer[i] = groundTileId;
  const decorLayer = tiles[2];
  for (let i = 0; i < decorLayer.length; i += DECOR_SPACING) decorLayer[i] = decorTileId;
  const updatedFloor: FloorDocument = { ...floor, layers: { ...floor.layers, tiles } };
  return { ...doc, floors: [updatedFloor, ...doc.floors.slice(1)] };
}

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
 * Bridges ONE floor of a `MapDocument` (default: floor 0, the ground floor
 * -- keeps every pre-Slice-4 single-floor call site unchanged) to the
 * `RpgmMap` shape `buildChunks` expects. Editor viewport callers pass the
 * ACTIVE floor's index explicitly (spec: "editor viewport shows active
 * floor only" -- never more than one floor's chunks are ever built at once
 * for painting).
 */
export function toRenderableMap(doc: MapDocument, floorIndex = 0): RpgmMap {
  const floor = doc.floors[floorIndex];
  if (!floor) {
    throw new Error(
      `toRenderableMap: no floor at index ${floorIndex} (doc has ${doc.floors.length} floor(s)).`,
    );
  }
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

/** One floor's painter-facing init data, sourced from a document's own `FloorDocument` -- shape matches `painter-store.ts`'s `PainterFloorInit` (both modules live in this same app's `src/`, not separate packages). Deliberately NOT imported from `painter-store.ts` (would create an import-cycle risk between the two -- see the `CatalogTilesetSource` comment below for the same pattern); kept as a plain structural type here instead. Cross-reference: `painter-store.ts` also defines `PainterFloorState` (this shape plus `commandStack`) -- all three types are intentionally parallel, not accidentally divergent (see `PainterFloorState`'s own doc comment). */
export interface PainterFloorSource {
  readonly id: string;
  readonly label?: string;
  readonly baseElevation: number;
  readonly layers: TileLayerSet;
}

/**
 * Builds the painter store's initial per-floor list from a loaded/composed
 * document's `floors[]`. Only the 4 editable tile layers travel into the
 * painter store -- shadows/regions/`lightMap` are read-only passthrough data,
 * not painted by this slice (see `composeDocumentFromPainterFloors`, which
 * re-attaches them on save). Command-stack history is NOT restored here:
 * `painter-store.ts`'s `createPainterState` always starts every floor with
 * a fresh, empty undo/redo stack (session-local, never persisted).
 */
export function painterFloorsFromDocument(doc: MapDocument): readonly PainterFloorSource[] {
  return doc.floors.map((floor) => ({
    id: floor.id,
    ...(floor.label !== undefined ? { label: floor.label } : {}),
    baseElevation: floor.baseElevation,
    layers: floor.layers.tiles,
  }));
}

/**
 * Composes a full `MapDocument` from the painter store's current per-floor
 * tile layers, re-attaching each floor's original shadows/regions/`lightMap`
 * (untouched passthrough; a brand-new floor added in-session -- with no
 * matching original floor id -- gets blank shadows/regions and no lightMap,
 * same as `createBlankMapDocument`). Any `stairLinks`/`rooms`/`spawn` entry
 * referencing a floor id no longer present is dropped (spec/task: "remove
 * drops referencing stair-links"; rooms and spawn mirror this exactly --
 * see `validateRooms`/`validateSpawn`'s floor-ref checks, which would
 * otherwise reject a dangling reference on save/export).
 *
 * `rooms` (techos-y-oclusion-interiores Slice 5a): defaults to the source
 * document's own `rooms` when omitted, so every pre-Slice-5a call site
 * (still passing only 2 args) keeps composing byte-identical output for a
 * roomless map (regression). Real callers authoring rooms via
 * `painter-store.ts`'s room CRUD ops (`addRoom`/`removeRoom`/etc.) pass
 * their live `PainterState.rooms` here explicitly.
 *
 * `stairLinks`/`spawn` (loop-crear-jugar Slice 5a): same default-to-source
 * precedent as `rooms` -- omitting either 4th/5th arg keeps composing the
 * source document's own value (regression: a roomless/stairless/spawnless
 * map still composes `stairLinks: []` and omits `spawn` entirely, matching
 * `createBlankMapDocument`'s shape). Real callers authoring stair-links/
 * spawn via `painter-store.ts` (`addStairLink`/`removeStairLink`/
 * `toggleStairLinkBidirectional`/`setSpawn`/`clearSpawn`) pass their live
 * `PainterState.stairLinks`/`PainterState.spawn` here explicitly.
 * `exactOptionalPropertyTypes` requires actually OMITTING the `spawn` key
 * when it composes to `undefined` (assigning `spawn: undefined` is a type
 * error), hence the two-branch return below, same shape as `schema.ts`'s
 * `validateCurrentVersionShape`.
 */
export function composeDocumentFromPainterFloors(
  doc: MapDocument,
  floors: readonly PainterFloorSource[],
  rooms: readonly RoomDocument[] = doc.rooms,
  stairLinks: readonly StairLinkDocument[] = doc.stairLinks,
  spawn: MapSpawn | undefined = doc.spawn,
  props: readonly PropDocument[] = doc.props,
  // Live painter-store collections (c1a follow-up place tools). Default to the
  // source document so pre-follow-up call sites stay byte-identical.
  npcs: readonly NpcDocument[] = doc.npcs,
  triggers: readonly TriggerDocument[] = doc.triggers,
  // Live events/worldSeeds (events editor WU-01). Default to the source document
  // so pre-WU-01 call sites stay byte-identical; when the painter passes live
  // state, stale-doc entries are NOT resurrected.
  events: MapDocument['events'] = doc.events,
  worldSeeds: MapDocument['worldSeeds'] = doc.worldSeeds,
  // Live lights (schema v6 WU-LIGHT-01). Default to the source document so
  // pre-light-store call sites stay byte-identical; floor-scoped placed lights
  // drop when their floor is removed. Attached lights (no floor) always keep.
  lights: readonly LightDocument[] = doc.lights,
): MapDocument {
  const originalById = new Map(doc.floors.map((floor) => [floor.id, floor] as const));
  const blankLayer = new Array(doc.width * doc.height).fill(0);

  const composedFloors: FloorDocument[] = floors.map((floor) => {
    const original = originalById.get(floor.id);
    const layers: MapLayers = {
      tiles: floor.layers,
      shadows: original?.layers.shadows ?? blankLayer,
      regions: original?.layers.regions ?? blankLayer,
    };
    // Schema v6: optional per-floor lightMap sha is passthrough (omit when absent).
    const lightMap = original?.lightMap;
    const baseFloor =
      floor.label !== undefined
        ? { id: floor.id, label: floor.label, baseElevation: floor.baseElevation, layers }
        : { id: floor.id, baseElevation: floor.baseElevation, layers };
    return lightMap !== undefined ? { ...baseFloor, lightMap } : baseFloor;
  });

  const floorIds = new Set(floors.map((floor) => floor.id));
  const composedStairLinks = stairLinks.filter(
    (link) => floorIds.has(link.fromFloor) && floorIds.has(link.toFloor),
  );
  const composedRooms = rooms.filter((room) => floorIds.has(room.floor));
  const composedSpawn = spawn !== undefined && floorIds.has(spawn.floor) ? spawn : undefined;
  // Schema v4 (c1a-authored-events-npcs): `npcs`/`triggers` reference their
  // floor by stable id exactly like `rooms`/`stairLinks`/`spawn`, so a removed
  // floor must drop them here too -- `validateNpc`/`validateTrigger` reject a
  // dangling reference on the next parse. Live painter-store arrays are passed
  // in (same shape as `props`) so place/delete survives compose; floor-filter
  // still applies. `events`/`worldSeeds` carry no floor reference; live painter
  // values are threaded explicitly so edits/deletes survive save (they no
  // longer ride the spread untouched).
  const composedNpcs = npcs.filter((npc) => floorIds.has(npc.floor));
  const composedTriggers = triggers.filter((trigger) => floorIds.has(trigger.floor));
  // Schema v5 (depth-props-hd C5 WU-04): props join the same floor-scoped
  // filter so a deleted floor cannot leave a dangling prop.floor behind.
  const composedProps = props.filter((prop) => floorIds.has(prop.floor));
  // Schema v6: placed lights are floor-scoped; attached lights have no floor.
  // Also drop attach targets that are not player and not in composedNpcs
  // (safety net if store prune was skipped — save must not emit invalid docs).
  const floorScopedLights = lights.filter(
    (light) => light.floor === undefined || floorIds.has(light.floor),
  );
  const composedLights = pruneLightsForNpcs(floorScopedLights, composedNpcs);

  const { spawn: _originalSpawn, ...docWithoutSpawn } = doc;
  const base = {
    ...docWithoutSpawn,
    floors: composedFloors,
    stairLinks: composedStairLinks,
    rooms: composedRooms,
    npcs: composedNpcs,
    triggers: composedTriggers,
    props: composedProps,
    lights: composedLights,
    events,
    worldSeeds,
  };
  return composedSpawn === undefined ? base : { ...base, spawn: composedSpawn };
}

/** Bridges a `MapDocument`'s merged flags to the `RpgmTileset` shape `buildChunks` expects. `sheetNames` is unused by the renderer's build pipeline (only `computeTileUv`'s caller-provided `sheetPixelSizes` matters), so it's a harmless placeholder. */
export function toRenderableTileset(doc: MapDocument): RpgmTileset {
  return {
    id: 0,
    name: doc.name,
    sheetNames: EMPTY_SHEET_NAMES,
    flags: doc.tileset.flags,
  };
}

/** Minimal structural shape of a fetched catalog tileset -- deliberately NOT importing `TilesetRow` from `catalog-client.ts` (would create an import cycle risk; this is a one-way consumer). */
export interface CatalogTilesetSource {
  readonly id: number;
  readonly gameId: number;
  readonly flags: string | null;
  readonly sheets: readonly { readonly slot: string; readonly sha256: string }[];
}

export interface SlotTilesetSource {
  readonly slot: TileSheetSlot;
  readonly tileset: CatalogTilesetSource;
}

export interface ComposeMapFromTilesetsOptions {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly sources: readonly SlotTilesetSource[];
}

/** Composes a blank multi-tileset map from already-fetched catalog tileset rows -- one real source per slot, each contributing its own id-range's flags (see `mergeSlotFlags`). A slot whose tileset has no sheet for that slot is silently skipped (not every tileset populates every slot). Adjacent same-typed `width`/`height` args are grouped into one options object -- see the gate-review "parameter objects" suggestion. */
export function composeMapFromTilesets(options: ComposeMapFromTilesetsOptions): MapDocument {
  const { id, name, width, height, sources } = options;
  const slots: Record<string, { object: string; sourceTilesetId: number; sourceGameId: number }> =
    {};
  const flagSources: SlotSourceFlags[] = [];
  for (const source of sources) {
    const sheet = source.tileset.sheets.find((entry) => entry.slot === source.slot);
    if (!sheet) continue;
    slots[source.slot] = {
      object: sheet.sha256,
      sourceTilesetId: source.tileset.id,
      sourceGameId: source.tileset.gameId,
    };
    const parsedFlags = source.tileset.flags ? (JSON.parse(source.tileset.flags) as number[]) : [];
    flagSources.push({ slot: source.slot, sourceFlags: parsedFlags });
  }
  const flags = mergeSlotFlags(flagSources);
  return createBlankMapDocument({
    id,
    name,
    width,
    height,
    slots: slots as SlotComposition,
    flags,
  });
}
