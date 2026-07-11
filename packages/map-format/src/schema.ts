/**
 * Versioned `.tmmap.json` map document schema (Slice 4 design: "Map Format
 * v1"). Pure, browser-safe -- no Node/file IO here (see `migrate.ts` for the
 * version-dispatch entry point that callers actually use, and the editor's
 * own save/load wiring for the actual file IO).
 *
 * Multi-tileset composition is achieved via per-SLOT sourcing (design's
 * "Multi-tileset model v1" decision): each of the 9 RPGM sheet slots can be
 * independently sourced from any catalog tileset, NOT per-cell arbitrary
 * mixing (that's reserved for a future format version, hence the `version`
 * field).
 */

/** One of RPG Maker's 9 fixed tileset sheet slots. */
export type TileSheetSlot = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'C' | 'D' | 'E';

export const TILE_SHEET_SLOTS: readonly TileSheetSlot[] = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B',
  'C',
  'D',
  'E',
];

/** Where one slot's sheet image comes from: a catalog object (by content hash) plus provenance. */
export interface SlotSource {
  /** Content-addressed sha256 of the sheet PNG, resolvable via the asset catalog's object store. */
  readonly object?: string;
  /** Catalog `tilesets.id` this slot's sheet was copied from, for provenance/re-editing. */
  readonly sourceTilesetId?: number;
  /** Catalog `games.id` this slot's sheet was copied from, for provenance/re-editing. */
  readonly sourceGameId?: number;
}

/** Per-slot composition: each slot may be empty (`{}`) or sourced from a catalog tileset. */
export type SlotComposition = Partial<Record<TileSheetSlot, SlotSource>>;

/** Semantic classes a tile id can carry, independent of its visual sheet/shape reference. */
export type SemanticClass = 'wall' | 'door' | 'window' | 'furniture' | 'ramp' | 'none';

/**
 * Explicit downhill-direction override for a `'ramp'`-classed tile id
 * (ramps-y-escaleras design: "Direction derivation" table). When present and
 * valid (the neighbor in that direction sits exactly one height level below
 * the ramp cell), it wins over the auto-derived direction; otherwise it is
 * ignored and derivation falls back to the unique-candidate / tie-break /
 * inert rule. Additive to v1 -- no schema version bump (an unset field on
 * older documents simply means "no override", matching non-ramp behavior).
 */
export type RampDirection = 'north' | 'south' | 'east' | 'west';

export interface TileSemanticEntry {
  readonly class: SemanticClass;
  /** Only meaningful when `class` is `'ramp'`; ignored otherwise. See `RampDirection`. */
  readonly rampDirection?: RampDirection;
  /** Reserved extension bag for future semantic metadata; not interpreted by this package. */
  readonly ext?: Readonly<Record<string, unknown>>;
}

/** Per-tile-id semantic overrides, keyed by the tile id as a decimal string (JSON object keys are always strings). */
export type SemanticOverrides = Readonly<Record<string, TileSemanticEntry>>;

export interface MapTilesetDocument {
  readonly slots: SlotComposition;
  /** RPGM per-tile-id flags bitfield, merged per-slot from each slot's source tileset. */
  readonly flags: readonly number[];
  readonly semantics: SemanticOverrides;
}

/** One tile layer: row-major tile ids, length `width * height`, `0` = empty. */
export type TileLayerData = readonly number[];

export interface MapLayers {
  /** The 4 editable tile layers, index 0 = bottom, matching `RpgmMapLayers.tileLayers`. */
  readonly tiles: readonly [TileLayerData, TileLayerData, TileLayerData, TileLayerData];
  readonly shadows: TileLayerData;
  readonly regions: TileLayerData;
}

export const MAP_FORMAT_MAGIC = 'threemaker-map' as const;
export const CURRENT_MAP_FORMAT_VERSION = 1;

export interface MapDocument {
  readonly format: typeof MAP_FORMAT_MAGIC;
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileset: MapTilesetDocument;
  readonly layers: MapLayers;
}

export type MapFormatErrorCode = 'bad-magic' | 'unsupported-version' | 'malformed';

export class MapFormatError extends Error {
  readonly code: MapFormatErrorCode;

  constructor(code: MapFormatErrorCode, message: string) {
    super(message);
    this.name = 'MapFormatError';
    this.code = code;
  }
}

/**
 * Structural validation of a document ALREADY at `CURRENT_MAP_FORMAT_VERSION`
 * (magic + version dispatch happens in `migrate.ts`'s `parseMapDocument`,
 * which is the entry point real callers use -- this function exists
 * separately so `migrate.ts` can validate the final, migrated shape without
 * a circular import back into itself).
 */
export function validateCurrentVersionShape(input: unknown): MapDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', 'Map document must be a non-null object.');
  }
  const raw = input as Record<string, unknown>;

  if (raw.format !== MAP_FORMAT_MAGIC) {
    throw new MapFormatError(
      'bad-magic',
      `Expected "format" to be ${JSON.stringify(MAP_FORMAT_MAGIC)}, got ${JSON.stringify(raw.format)}.`,
    );
  }
  if (raw.version !== CURRENT_MAP_FORMAT_VERSION) {
    throw new MapFormatError(
      'malformed',
      `validateCurrentVersionShape requires version ${CURRENT_MAP_FORMAT_VERSION}, got ${JSON.stringify(raw.version)}.`,
    );
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', '"id" must be a non-empty string.');
  }
  if (typeof raw.name !== 'string') {
    throw new MapFormatError('malformed', '"name" must be a string.');
  }
  if (!Number.isInteger(raw.width) || (raw.width as number) <= 0) {
    throw new MapFormatError('malformed', '"width" must be a positive integer.');
  }
  if (!Number.isInteger(raw.height) || (raw.height as number) <= 0) {
    throw new MapFormatError('malformed', '"height" must be a positive integer.');
  }

  const tileset = validateTileset(raw.tileset);
  const layers = validateLayers(raw.layers, raw.width as number, raw.height as number);

  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: raw.id,
    name: raw.name,
    width: raw.width as number,
    height: raw.height as number,
    tileset,
    layers,
  };
}

function validateTileset(input: unknown): MapTilesetDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', '"tileset" must be an object.');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.slots !== 'object' || raw.slots === null) {
    throw new MapFormatError('malformed', '"tileset.slots" must be an object.');
  }
  if (!Array.isArray(raw.flags) || !raw.flags.every((flag) => typeof flag === 'number')) {
    throw new MapFormatError('malformed', '"tileset.flags" must be a number array.');
  }
  if (typeof raw.semantics !== 'object' || raw.semantics === null) {
    throw new MapFormatError('malformed', '"tileset.semantics" must be an object.');
  }
  return {
    slots: raw.slots as SlotComposition,
    flags: raw.flags as readonly number[],
    semantics: raw.semantics as SemanticOverrides,
  };
}

function validateLayers(input: unknown, width: number, height: number): MapLayers {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', '"layers" must be an object.');
  }
  const raw = input as Record<string, unknown>;
  const size = width * height;

  if (!Array.isArray(raw.tiles) || raw.tiles.length !== 4) {
    throw new MapFormatError('malformed', '"layers.tiles" must be an array of exactly 4 layers.');
  }
  for (const layer of raw.tiles) {
    validateTileLayer(layer, size, 'layers.tiles[]');
  }
  validateTileLayer(raw.shadows, size, 'layers.shadows');
  validateTileLayer(raw.regions, size, 'layers.regions');

  const tiles = raw.tiles as [TileLayerData, TileLayerData, TileLayerData, TileLayerData];
  return {
    tiles,
    shadows: raw.shadows as TileLayerData,
    regions: raw.regions as TileLayerData,
  };
}

function validateTileLayer(input: unknown, expectedLength: number, label: string): void {
  if (!Array.isArray(input) || input.length !== expectedLength) {
    throw new MapFormatError(
      'malformed',
      `"${label}" must be a number array of length ${expectedLength} (width * height).`,
    );
  }
  if (!input.every((value) => typeof value === 'number' && Number.isInteger(value))) {
    throw new MapFormatError('malformed', `"${label}" must contain only integers.`);
  }
}

/** JSON-serializes a validated `MapDocument`. Pure/deterministic key order via `JSON.stringify`'s own object-key iteration. */
export function serializeMapDocument(doc: MapDocument): string {
  return JSON.stringify(doc);
}
