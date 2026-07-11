/**
 * Composes a fresh `MapDocument` from catalog tileset sources (Slice 4's
 * per-slot multi-tileset model) and bridges it to the shapes
 * `@threemaker/renderer`'s `buildChunks` already understands. Pure.
 */

import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import type { MapDocument, SlotComposition, TileSheetSlot } from '@threemaker/map-format';
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

/** A blank (all-zero) map at the current format version, with the given slot composition already set. */
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
    layers: {
      tiles: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
      shadows: emptyLayer(),
      regions: emptyLayer(),
    },
  };
}

/**
 * Seeds a freshly-created blank map with real tile ids from its composed
 * slots, so there is something to eyedrop/brush/fill/undo immediately.
 * ponytail: a full clickable tileset-image palette is out of scope this
 * slice (see apply-progress); eyedropper-first is the primary tile-
 * selection workflow, with these seeded tiles as the starting material.
 */
export function seedDemoTiles(
  doc: MapDocument,
  groundTileId: number,
  decorTileId: number,
): MapDocument {
  const tiles = doc.layers.tiles.map((layer) => layer.slice()) as [
    number[],
    number[],
    number[],
    number[],
  ];
  const groundLayer = tiles[0];
  for (let i = 0; i < groundLayer.length; i++) groundLayer[i] = groundTileId;
  const decorLayer = tiles[2];
  for (let i = 0; i < decorLayer.length; i += 7) decorLayer[i] = decorTileId;
  return { ...doc, layers: { ...doc.layers, tiles } };
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

/** Bridges a `MapDocument`'s layers to the `RpgmMap` shape `buildChunks` expects -- both use the same 4-tile-layer + shadows + regions structure. */
export function toRenderableMap(doc: MapDocument): RpgmMap {
  return {
    id: null,
    displayName: doc.name,
    width: doc.width,
    height: doc.height,
    tilesetId: 0,
    scrollType: 0,
    layers: {
      tileLayers: doc.layers.tiles,
      shadows: doc.layers.shadows,
      regions: doc.layers.regions,
    },
  };
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

/** Composes a blank multi-tileset map from already-fetched catalog tileset rows -- one real source per slot, each contributing its own id-range's flags (see `mergeSlotFlags`). A slot whose tileset has no sheet for that slot is silently skipped (not every tileset populates every slot). */
export function composeMapFromTilesets(
  id: string,
  name: string,
  width: number,
  height: number,
  sources: readonly SlotTilesetSource[],
): MapDocument {
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
