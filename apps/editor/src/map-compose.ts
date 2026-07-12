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
 * `@threemaker/map-format` for other, not-yet-floor-aware consumers, e.g.
 * `packages/exporter-rpgm`).
 */

import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import type {
  FloorDocument,
  MapDocument,
  MapLayers,
  SlotComposition,
  TileLayerSet,
  TileSheetSlot,
} from '@threemaker/map-format';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from '@threemaker/map-format';

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

export interface CreateBlankMapDocumentOptions {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly slots: SlotComposition;
  readonly flags: readonly number[];
}

/**
 * A blank (all-zero) map at the current format version, with the given slot
 * composition already set. Schema v2 (plantas-apiladas Slice 1): this
 * package is not yet floor-aware -- the blank map is a single floor
 * (`floor-0`, `baseElevation: 0`) with no stair-links, matching how a v1
 * document migrates. Multi-floor authoring lands in Slice 4.
 */
export function createBlankMapDocument(options: CreateBlankMapDocumentOptions): MapDocument {
  const size = options.width * options.height;
  const emptyLayer = (): number[] => new Array(size).fill(0);
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: options.id,
    name: options.name,
    width: options.width,
    height: options.height,
    tileset: { slots: options.slots, flags: options.flags, semantics: {} },
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: {
          tiles: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
          shadows: emptyLayer(),
          regions: emptyLayer(),
        },
      },
    ],
    stairLinks: [],
    // Schema v3 (techos-y-oclusion-interiores Slice 1): additive field, kept
    // empty here -- real room-authoring wiring for this composer lands in
    // that change's Slice 5a ("map-compose.ts emits v3 natively").
    rooms: [],
  };
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
 * painter store -- shadows/regions are read-only passthrough data, not
 * painted by this slice (see `composeDocumentFromPainterFloors`, which
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
 * Composes a full v2 `MapDocument` from the painter store's current
 * per-floor tile layers, re-attaching each floor's original shadows/
 * regions (untouched passthrough; a brand-new floor added in-session --
 * with no matching original floor id -- gets blank shadows/regions, same
 * as `createBlankMapDocument`). Any `stairLinks` entry referencing a floor
 * id no longer present is dropped (spec/task: "remove drops referencing
 * stair-links") -- a no-op today since this slice authors no stair-links,
 * but keeps a loaded document with stair-links safe against a floor
 * removal.
 */
export function composeDocumentFromPainterFloors(
  doc: MapDocument,
  floors: readonly PainterFloorSource[],
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
    return floor.label !== undefined
      ? { id: floor.id, label: floor.label, baseElevation: floor.baseElevation, layers }
      : { id: floor.id, baseElevation: floor.baseElevation, layers };
  });

  const floorIds = new Set(floors.map((floor) => floor.id));
  const stairLinks = doc.stairLinks.filter(
    (link) => floorIds.has(link.fromFloor) && floorIds.has(link.toFloor),
  );

  return { ...doc, floors: composedFloors, stairLinks };
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
