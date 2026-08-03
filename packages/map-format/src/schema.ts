/**
 * Versioned `.tmmap.json` map document schema. Pure, browser-safe -- no
 * Node/file IO here (see `migrate.ts` for the version-dispatch entry point
 * that callers actually use, and the editor's own save/load wiring for the
 * actual file IO).
 *
 * Multi-tileset composition is achieved via per-SLOT sourcing (design's
 * "Multi-tileset model v1" decision): each of the 9 RPGM sheet slots can be
 * independently sourced from any catalog tileset, NOT per-cell arbitrary
 * mixing (that's reserved for a future format version, hence the `version`
 * field).
 *
 * Schema v2 (plantas-apiladas design, Slice 1): a document is an ordered
 * stack of `FloorDocument`s (index = stacking order, `[0]` = ground) plus a
 * top-level list of `StairLinkDocument`s connecting them by stable floor id.
 * A v1 document (a single, un-stacked `layers` group) migrates losslessly
 * into a one-floor v2 document -- see `migrate.ts`'s `migrateV1ToV2`.
 *
 * Schema v3 (techos-y-oclusion-interiores design, Slice 1): additive
 * top-level `RoomDocument[]` (`rooms`), mirroring `stairLinks[]` exactly --
 * each room references its floor by stable id and carries one or more
 * tile-rect footprints. `computeRoomIdGrid` (`rooms.ts`) turns a floor's
 * rooms into a per-floor `Uint16Array` grid, `0` = unauthored (no room). A v2
 * document migrates losslessly into a roomless v3 document -- see
 * `migrate.ts`'s `migrateV2ToV3`.
 */

import type { EventCommand } from '@threemaker/core';
import { parseEventScript } from '@threemaker/core';

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
export const CURRENT_MAP_FORMAT_VERSION = 4;

/**
 * Default `baseElevation` increment for a newly-added floor (painter "add
 * floor" flow, plantas-apiladas Slice 4 -- CHECKPOINT-APPROVED default).
 * Not consumed by this slice's schema/migration logic; defined here so the
 * constant has a single home ahead of the slice that wires it up.
 */
export const DEFAULT_FLOOR_HEIGHT = 3;

/** One stacked floor: its own stable id (survives reordering/save-reload), vertical offset, and tile/shadow/region layers. */
export interface FloorDocument {
  readonly id: string;
  readonly label?: string;
  readonly baseElevation: number;
  readonly layers: MapLayers;
}

/** One waypoint along a stair-link's authored path; `floor` is the stable `FloorDocument.id` that waypoint sits on. */
export interface StairLinkWaypoint {
  readonly x: number;
  readonly y: number;
  readonly floor: string;
}

/**
 * Waypoint-based transition primitive between two floors (design: "stair-link
 * ... decoupled from the edge-profile rule"). `waypoints[0]` is the entry
 * point on `fromFloor`, the last is the landing on `toFloor`; interior
 * waypoints carry no edge-profile/ramp checks. `bidirectional: true` is the
 * authoring act for a return path (traversed via the reversed waypoint
 * order) -- no auto-reverse is ever inferred from a one-way link.
 */
export interface StairLinkDocument {
  readonly id: string;
  readonly fromFloor: string;
  readonly toFloor: string;
  readonly bidirectional: boolean;
  readonly waypoints: readonly StairLinkWaypoint[];
}

/** One rectangular tile-coordinate footprint of a `RoomDocument`, in-bounds validated against the map's `width`/`height`. */
export interface RoomRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One authored room (techos-y-oclusion-interiores design, "Room authoring
 * model"): a stable id, an optional display name, the `FloorDocument.id` it
 * sits on, and >=1 tile-rect footprints (a single logical, possibly
 * L-shaped, room = one fade unit). `computeRoomIdGrid` (`rooms.ts`) turns a
 * floor's rooms into a per-floor `Uint16Array` grid; `id` uniqueness is
 * enforced PER FLOOR only (two rooms on different floors may share an id --
 * see `validateRooms`), since the grid's own cell values encode a
 * floor-scoped 1-based ordinal, never `id` itself.
 */
export interface RoomDocument {
  readonly id: string;
  readonly name?: string;
  readonly floor: string;
  readonly rects: readonly RoomRect[];
}

/**
 * Authored player-spawn point (loop-crear-jugar design, "Spawn schema" --
 * additive, no version bump, same pattern as `rampDirection`). References its
 * floor by stable `FloorDocument.id`, matching `StairLinkWaypoint`'s
 * floor-reference convention. The runtime honors it when the referenced tile
 * is standable on that floor, else falls back to `findSpawnTile` silently
 * (design: "Runtime spawn" -- authored docs may go stale vs. layers, the test
 * loop must never brick on a bad spawn).
 */
export interface MapSpawn {
  readonly x: number;
  readonly y: number;
  readonly floor: string;
}

/** Facing domain for an authored NPC: the same value domain as gameplay's `Direction` (`packages/gameplay/src/grid-mover.ts:2`), restated here so this package stays dependency-free. */
export type NpcFacing = 'down' | 'left' | 'right' | 'up';

/** Content-addressed NPC sheet reference, mirroring `ManifestActorSheet` (`apps/desktop/src/game-manifest.ts:25-30`) -- desktop has no catalog access, so the document carries the sha256 directly. */
export interface NpcSpriteRef {
  readonly object: string;
  readonly characterIndex: number;
}

/** One authored NPC (schema v4). `floor` references a stable `FloorDocument.id` like `MapSpawn`; `onInteract` keys into `MapDocument.events`. */
export interface NpcDocument {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly floor: string;
  readonly facing: NpcFacing;
  readonly sprite: NpcSpriteRef;
  readonly onInteract: string;
}

/** One authored trigger (schema v4). `event` keys into `MapDocument.events`. */
export interface TriggerDocument {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly floor: string;
  readonly on: 'enter' | 'interact';
  readonly event: string;
}

/** Authored event scripts keyed by event key. Command-level validation is delegated to `@threemaker/core`'s `parseEventScript` (see `validateEvents`). */
export type MapEventScripts = Readonly<Record<string, readonly EventCommand[]>>;

/** A world-state seed value: primitives only, matching the runtime's `WorldValue`. */
export type WorldSeedValue = boolean | number | string;

export interface MapDocument {
  readonly format: typeof MAP_FORMAT_MAGIC;
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileset: MapTilesetDocument;
  /** Ordered floor stack, index = stacking order, `[0]` = ground. MUST be non-empty. */
  readonly floors: readonly FloorDocument[];
  /** Stable-floor-id-referencing transitions between floors. Empty for a single-floor document. */
  readonly stairLinks: readonly StairLinkDocument[];
  /** Stable-floor-id-referencing room footprints (schema v3, additive). Empty for a document with no authored rooms. */
  readonly rooms: readonly RoomDocument[];
  /** Authored player-spawn point (loop-crear-jugar, additive). Omitted entirely when unauthored -- never emitted as an `undefined`-valued key, matching `label`'s optional-field convention. */
  readonly spawn?: MapSpawn;
  /**
   * Authored narrative content (schema v4). All four are REQUIRED with empty
   * defaults -- never optional like `spawn?` -- so every object literal typed
   * as `MapDocument` (this module's rebuilt shape, the editor's blank
   * document) fails to COMPILE when a field is not mirrored, instead of
   * dropping it silently.
   */
  readonly npcs: readonly NpcDocument[];
  readonly triggers: readonly TriggerDocument[];
  readonly events: MapEventScripts;
  readonly worldSeeds: Readonly<Record<string, WorldSeedValue>>;
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
  const floors = validateFloors(raw.floors, raw.width as number, raw.height as number);
  const floorIds = new Set(floors.map((floor) => floor.id));
  const stairLinks = validateStairLinks(raw.stairLinks, floorIds);
  const rooms = validateRooms(raw.rooms, floorIds, raw.width as number, raw.height as number);
  const spawn = validateSpawn(raw.spawn, floorIds, raw.width as number, raw.height as number);
  const npcs = validateNpcs(raw.npcs, floorIds, raw.width as number, raw.height as number);
  const triggers = validateTriggers(
    raw.triggers,
    floorIds,
    raw.width as number,
    raw.height as number,
  );
  const events = validateEvents(raw.events);
  const worldSeeds = validateWorldSeeds(raw.worldSeeds);

  return spawn === undefined
    ? {
        format: MAP_FORMAT_MAGIC,
        version: CURRENT_MAP_FORMAT_VERSION,
        id: raw.id,
        name: raw.name,
        width: raw.width as number,
        height: raw.height as number,
        tileset,
        floors,
        stairLinks,
        rooms,
        npcs,
        triggers,
        events,
        worldSeeds,
      }
    : {
        format: MAP_FORMAT_MAGIC,
        version: CURRENT_MAP_FORMAT_VERSION,
        id: raw.id,
        name: raw.name,
        width: raw.width as number,
        height: raw.height as number,
        tileset,
        floors,
        stairLinks,
        rooms,
        spawn,
        npcs,
        triggers,
        events,
        worldSeeds,
      };
}

/**
 * Collection-level guard shared by `npcs`/`triggers`: an absent key collapses
 * to the empty default (so a v3 document and every pre-v4 fixture keep
 * parsing), and a present value must be an array.
 */
function validateNarrativeArray(input: unknown, label: string): readonly unknown[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new MapFormatError('malformed', `"${label}" must be an array.`);
  }
  return input as readonly unknown[];
}

/** Record counterpart to `validateNarrativeArray` -- absent collapses to `{}`, present must be a plain object. */
function validateNarrativeRecord(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new MapFormatError('malformed', `"${label}" must be an object.`);
  }
  return input as Readonly<Record<string, unknown>>;
}

/**
 * Floor reference shared by `npcs`/`triggers`, mirroring `spawn`/`rooms`/
 * `stairLinks`' floor-id convention. The message names the ENTRY ID as well as
 * the offending value: an authored document that outlived a deleted floor is
 * otherwise only diagnosable by counting array indices by hand.
 */
function validateNarrativeFloor(
  input: unknown,
  label: string,
  id: string,
  floorIds: ReadonlySet<string>,
): string {
  if (typeof input !== 'string' || !floorIds.has(input)) {
    throw new MapFormatError(
      'malformed',
      `"${label}.floor" of ${JSON.stringify(id)} must reference an existing floor id, got ${JSON.stringify(input)}.`,
    );
  }
  return input;
}

/** In-bounds tile coordinate shared by `npcs`/`triggers`, matching `validateSpawn`'s `[0, limit)` rule. */
function validateNarrativeCoord(
  input: unknown,
  label: string,
  field: 'x' | 'y',
  id: string,
  limit: number,
): number {
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) >= limit) {
    throw new MapFormatError(
      'malformed',
      `"${label}.${field}" of ${JSON.stringify(id)} must be an integer within [0, ${limit}), got ${JSON.stringify(input)}.`,
    );
  }
  return input as number;
}

const NPC_FACINGS: readonly NpcFacing[] = ['down', 'left', 'right', 'up'];
const TRIGGER_KINDS: readonly TriggerDocument['on'][] = ['enter', 'interact'];

function validateNpcs(
  input: unknown,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): readonly NpcDocument[] {
  const npcs = validateNarrativeArray(input, 'npcs').map((entry, index) =>
    validateNpc(entry, index, floorIds, mapWidth, mapHeight),
  );

  // Tile occupancy is a hard content-authoring invariant, ported from
  // gameplay's since-deleted `parseNpcs`: NPCs collide, so two on one tile leaves one
  // permanently unreachable. Scoped PER FLOOR exactly like `validateRooms`' id
  // uniqueness -- the same x,y on two floors is two distinct tiles. The first
  // claimant's index is tracked so the error names both conflicting entries.
  const firstIndexByTile = new Map<string, number>();
  for (const [index, npc] of npcs.entries()) {
    const key = `${npc.floor} ${npc.x},${npc.y}`;
    const firstIndex = firstIndexByTile.get(key);
    if (firstIndex !== undefined) {
      throw new MapFormatError(
        'malformed',
        `"npcs[${index}]" (${JSON.stringify(npc.id)}) occupies the same tile (${npc.x},${npc.y}) on floor ${JSON.stringify(npc.floor)} as "npcs[${firstIndex}]".`,
      );
    }
    firstIndexByTile.set(key, index);
  }

  // NPC ids must be unique across the document (not just per floor). Runtime
  // lookup and authored scripting key by id; a collision silently shadows one
  // of the entries. C1a follow-up paid 2026-08-02.
  const firstIndexById = new Map<string, number>();
  for (const [index, npc] of npcs.entries()) {
    const firstIndex = firstIndexById.get(npc.id);
    if (firstIndex !== undefined) {
      throw new MapFormatError(
        'malformed',
        `"npcs[${index}]" (${JSON.stringify(npc.id)}) reuses the same id as "npcs[${firstIndex}]".`,
      );
    }
    firstIndexById.set(npc.id, index);
  }

  return npcs;
}

function validateNpc(
  input: unknown,
  index: number,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): NpcDocument {
  const label = `npcs[${index}]`;
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"${label}" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', `"${label}.id" must be a non-empty string.`);
  }
  const floor = validateNarrativeFloor(raw.floor, label, raw.id, floorIds);
  const x = validateNarrativeCoord(raw.x, label, 'x', raw.id, mapWidth);
  const y = validateNarrativeCoord(raw.y, label, 'y', raw.id, mapHeight);
  if (typeof raw.facing !== 'string' || !NPC_FACINGS.includes(raw.facing as NpcFacing)) {
    throw new MapFormatError(
      'malformed',
      `"${label}.facing" must be one of ${NPC_FACINGS.join(', ')}, got ${JSON.stringify(raw.facing)}.`,
    );
  }
  const sprite = validateNpcSprite(raw.sprite, label);
  if (typeof raw.onInteract !== 'string' || raw.onInteract.length === 0) {
    throw new MapFormatError('malformed', `"${label}.onInteract" must be a non-empty string.`);
  }
  return {
    id: raw.id,
    x,
    y,
    floor,
    facing: raw.facing as NpcFacing,
    sprite,
    onInteract: raw.onInteract,
  };
}

function validateNpcSprite(input: unknown, label: string): NpcSpriteRef {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"${label}.sprite" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.object !== 'string' || raw.object.length === 0) {
    throw new MapFormatError('malformed', `"${label}.sprite.object" must be a non-empty string.`);
  }
  if (!Number.isInteger(raw.characterIndex) || (raw.characterIndex as number) < 0) {
    throw new MapFormatError(
      'malformed',
      `"${label}.sprite.characterIndex" must be a non-negative integer, got ${JSON.stringify(raw.characterIndex)}.`,
    );
  }
  return { object: raw.object, characterIndex: raw.characterIndex as number };
}

function validateTriggers(
  input: unknown,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): readonly TriggerDocument[] {
  const triggers = validateNarrativeArray(input, 'triggers').map((entry, index) =>
    validateTrigger(entry, index, floorIds, mapWidth, mapHeight),
  );

  const firstIndexById = new Map<string, number>();
  for (const [index, trig] of triggers.entries()) {
    const firstIndex = firstIndexById.get(trig.id);
    if (firstIndex !== undefined) {
      throw new MapFormatError(
        'malformed',
        `"triggers[${index}]" (${JSON.stringify(trig.id)}) reuses the same id as "triggers[${firstIndex}]".`,
      );
    }
    firstIndexById.set(trig.id, index);
  }

  return triggers;
}

function validateTrigger(
  input: unknown,
  index: number,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): TriggerDocument {
  const label = `triggers[${index}]`;
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"${label}" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', `"${label}.id" must be a non-empty string.`);
  }
  const floor = validateNarrativeFloor(raw.floor, label, raw.id, floorIds);
  const x = validateNarrativeCoord(raw.x, label, 'x', raw.id, mapWidth);
  const y = validateNarrativeCoord(raw.y, label, 'y', raw.id, mapHeight);
  if (typeof raw.on !== 'string' || !TRIGGER_KINDS.includes(raw.on as TriggerDocument['on'])) {
    throw new MapFormatError(
      'malformed',
      `"${label}.on" must be one of ${TRIGGER_KINDS.join(', ')}, got ${JSON.stringify(raw.on)}.`,
    );
  }
  if (typeof raw.event !== 'string' || raw.event.length === 0) {
    throw new MapFormatError('malformed', `"${label}.event" must be a non-empty string.`);
  }
  return { id: raw.id, x, y, floor, on: raw.on as TriggerDocument['on'], event: raw.event };
}

/**
 * Command-level validation is core's, not ours: the envelope
 * `{version: 1, events}` is synthesized here because `parseEventScript` is
 * core's only public entry point (`parseEventCommand` is unexported), keeping a
 * single command-schema definition instead of a drifting duplicate. Core's
 * plain `Error` is re-wrapped as a `MapFormatError` so `parseMapDocument` keeps
 * exactly one error type for every rejection, with core's own path-naming
 * message text preserved verbatim.
 */
function validateEvents(input: unknown): MapEventScripts {
  const events = validateNarrativeRecord(input, 'events');
  try {
    return parseEventScript({ version: 1, events });
  } catch (error) {
    throw new MapFormatError(
      'malformed',
      `"events" is not a valid event script: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * `WorldValue` primitives only (`packages/core/src/world-state.ts`) -- a nested
 * object or array would reach `seedIfAbsent` unusable.
 *
 * The returned record is a COPY, never the caller's own object: every other
 * collection here is rebuilt entry-by-entry, so a validated document must not
 * be the one place that keeps sharing mutable state with the untrusted input
 * JSON (a later mutation of that input would otherwise reach through this
 * document's `readonly` seeds unvalidated).
 */
function validateWorldSeeds(input: unknown): Readonly<Record<string, WorldSeedValue>> {
  const seeds = { ...validateNarrativeRecord(input, 'worldSeeds') };
  for (const [key, value] of Object.entries(seeds)) {
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
      throw new MapFormatError(
        'malformed',
        `"worldSeeds.${key}" must be a boolean, number, or string, got ${JSON.stringify(value)}.`,
      );
    }
  }
  return seeds as Readonly<Record<string, WorldSeedValue>>;
}

function validateFloors(input: unknown, width: number, height: number): readonly FloorDocument[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new MapFormatError('malformed', '"floors" must be a non-empty array.');
  }
  const floors = input.map((entry, index) => validateFloor(entry, index, width, height));

  // Stair-links reference floors by id (see `validateStairLink`); a duplicate
  // id makes every `fromFloor`/`toFloor`/`waypoints[].floor` referencing it
  // ambiguous, with nothing able to disambiguate which floor was meant.
  const firstIndexById = new Map<string, number>();
  for (const [index, floor] of floors.entries()) {
    const firstIndex = firstIndexById.get(floor.id);
    if (firstIndex !== undefined) {
      throw new MapFormatError(
        'malformed',
        `"floors[${index}].id" duplicates "floors[${firstIndex}].id" (both are ${JSON.stringify(floor.id)}); floor ids must be unique.`,
      );
    }
    firstIndexById.set(floor.id, index);
  }

  return floors;
}

function validateFloor(
  input: unknown,
  index: number,
  width: number,
  height: number,
): FloorDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"floors[${index}]" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', `"floors[${index}].id" must be a non-empty string.`);
  }
  if (typeof raw.baseElevation !== 'number' || !Number.isFinite(raw.baseElevation)) {
    throw new MapFormatError(
      'malformed',
      `"floors[${index}].baseElevation" must be a finite number.`,
    );
  }
  if (raw.label !== undefined && typeof raw.label !== 'string') {
    throw new MapFormatError(
      'malformed',
      `"floors[${index}].label" must be a string when present.`,
    );
  }
  const layers = validateLayers(raw.layers, width, height, `floors[${index}].layers`);
  return raw.label === undefined
    ? { id: raw.id, baseElevation: raw.baseElevation, layers }
    : { id: raw.id, label: raw.label, baseElevation: raw.baseElevation, layers };
}

function validateStairLinks(
  input: unknown,
  floorIds: ReadonlySet<string>,
): readonly StairLinkDocument[] {
  if (!Array.isArray(input)) {
    throw new MapFormatError('malformed', '"stairLinks" must be an array.');
  }
  return input.map((entry, index) => validateStairLink(entry, index, floorIds));
}

function validateStairLink(
  input: unknown,
  index: number,
  floorIds: ReadonlySet<string>,
): StairLinkDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"stairLinks[${index}]" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', `"stairLinks[${index}].id" must be a non-empty string.`);
  }
  if (typeof raw.fromFloor !== 'string' || !floorIds.has(raw.fromFloor)) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${index}].fromFloor" must reference an existing floor id.`,
    );
  }
  if (typeof raw.toFloor !== 'string' || !floorIds.has(raw.toFloor)) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${index}].toFloor" must reference an existing floor id.`,
    );
  }
  if (typeof raw.bidirectional !== 'boolean') {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${index}].bidirectional" must be a boolean.`,
    );
  }
  const waypoints = validateWaypoints(raw.waypoints, index, floorIds);

  // Doc comment contract: waypoints[0] is the entry point ON fromFloor, the
  // last is the landing ON toFloor -- enforce it here so an authoring bug
  // (endpoint floor mismatch) is caught at validation time, not at traversal
  // time (Slice 5).
  const firstWaypoint = waypoints[0];
  const lastWaypoint = waypoints[waypoints.length - 1];
  if (firstWaypoint && firstWaypoint.floor !== raw.fromFloor) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${index}].waypoints[0].floor" (${JSON.stringify(firstWaypoint.floor)}) must match "stairLinks[${index}].fromFloor" (${JSON.stringify(raw.fromFloor)}).`,
    );
  }
  if (lastWaypoint && lastWaypoint.floor !== raw.toFloor) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${index}].waypoints[${waypoints.length - 1}].floor" (${JSON.stringify(lastWaypoint.floor)}) must match "stairLinks[${index}].toFloor" (${JSON.stringify(raw.toFloor)}).`,
    );
  }

  return {
    id: raw.id,
    fromFloor: raw.fromFloor,
    toFloor: raw.toFloor,
    bidirectional: raw.bidirectional,
    waypoints,
  };
}

function validateWaypoints(
  input: unknown,
  linkIndex: number,
  floorIds: ReadonlySet<string>,
): readonly StairLinkWaypoint[] {
  if (!Array.isArray(input) || input.length < 2) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${linkIndex}].waypoints" must be an array of at least 2 waypoints.`,
    );
  }
  return input.map((entry, wIndex) => validateWaypoint(entry, linkIndex, wIndex, floorIds));
}

function validateWaypoint(
  input: unknown,
  linkIndex: number,
  wIndex: number,
  floorIds: ReadonlySet<string>,
): StairLinkWaypoint {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${linkIndex}].waypoints[${wIndex}]" must be an object.`,
    );
  }
  const raw = input as Record<string, unknown>;
  if (!Number.isInteger(raw.x)) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${linkIndex}].waypoints[${wIndex}].x" must be an integer.`,
    );
  }
  if (!Number.isInteger(raw.y)) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${linkIndex}].waypoints[${wIndex}].y" must be an integer.`,
    );
  }
  if (typeof raw.floor !== 'string' || !floorIds.has(raw.floor)) {
    throw new MapFormatError(
      'malformed',
      `"stairLinks[${linkIndex}].waypoints[${wIndex}].floor" must reference an existing floor id.`,
    );
  }
  return { x: raw.x as number, y: raw.y as number, floor: raw.floor };
}

function validateRooms(
  input: unknown,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): readonly RoomDocument[] {
  if (!Array.isArray(input)) {
    throw new MapFormatError('malformed', '"rooms" must be an array.');
  }
  const rooms = input.map((entry, index) =>
    validateRoom(entry, index, floorIds, mapWidth, mapHeight),
  );

  // Spec: "Unique room ids per floor" -- scoped per floor (not global), since
  // `computeRoomIdGrid`'s cell values encode a floor-scoped 1-based ordinal,
  // never `id` itself; two rooms on DIFFERENT floors may share an id.
  const firstIndexByFloorAndId = new Map<string, number>();
  for (const [index, room] of rooms.entries()) {
    const key = `${room.floor} ${room.id}`;
    const firstIndex = firstIndexByFloorAndId.get(key);
    if (firstIndex !== undefined) {
      throw new MapFormatError(
        'malformed',
        `"rooms[${index}].id" duplicates "rooms[${firstIndex}].id" (both are ${JSON.stringify(room.id)}) on floor ${JSON.stringify(room.floor)}; room ids must be unique per floor.`,
      );
    }
    firstIndexByFloorAndId.set(key, index);
  }

  return rooms;
}

function validateRoom(
  input: unknown,
  index: number,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): RoomDocument {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"rooms[${index}]" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new MapFormatError('malformed', `"rooms[${index}].id" must be a non-empty string.`);
  }
  if (raw.name !== undefined && typeof raw.name !== 'string') {
    throw new MapFormatError('malformed', `"rooms[${index}].name" must be a string when present.`);
  }
  if (typeof raw.floor !== 'string' || !floorIds.has(raw.floor)) {
    throw new MapFormatError(
      'malformed',
      `"rooms[${index}].floor" must reference an existing floor id.`,
    );
  }
  const rects = validateRoomRects(raw.rects, index, mapWidth, mapHeight);
  return raw.name === undefined
    ? { id: raw.id, floor: raw.floor, rects }
    : { id: raw.id, name: raw.name, floor: raw.floor, rects };
}

function validateRoomRects(
  input: unknown,
  roomIndex: number,
  mapWidth: number,
  mapHeight: number,
): readonly RoomRect[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new MapFormatError('malformed', `"rooms[${roomIndex}].rects" must be a non-empty array.`);
  }
  return input.map((entry, rectIndex) =>
    validateRoomRect(entry, roomIndex, rectIndex, mapWidth, mapHeight),
  );
}

function validateRoomRect(
  input: unknown,
  roomIndex: number,
  rectIndex: number,
  mapWidth: number,
  mapHeight: number,
): RoomRect {
  const label = `rooms[${roomIndex}].rects[${rectIndex}]`;
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"${label}" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  if (!Number.isInteger(raw.x) || (raw.x as number) < 0) {
    throw new MapFormatError('malformed', `"${label}.x" must be a non-negative integer.`);
  }
  if (!Number.isInteger(raw.y) || (raw.y as number) < 0) {
    throw new MapFormatError('malformed', `"${label}.y" must be a non-negative integer.`);
  }
  if (!Number.isInteger(raw.width) || (raw.width as number) <= 0) {
    throw new MapFormatError('malformed', `"${label}.width" must be a positive integer.`);
  }
  if (!Number.isInteger(raw.height) || (raw.height as number) <= 0) {
    throw new MapFormatError('malformed', `"${label}.height" must be a positive integer.`);
  }
  const x = raw.x as number;
  const y = raw.y as number;
  const width = raw.width as number;
  const height = raw.height as number;
  // Spec scenario "Cell references existing room": a rect reaching outside
  // the map would carve/paint cells that can never resolve back to a real
  // room at grid-computation time -- rejected here, at authoring time.
  if (x + width > mapWidth || y + height > mapHeight) {
    throw new MapFormatError(
      'malformed',
      `"${label}" (x=${x}, y=${y}, width=${width}, height=${height}) must stay within the map bounds ${mapWidth}x${mapHeight}.`,
    );
  }
  return { x, y, width, height };
}

/**
 * Optional -- `undefined` input (unauthored spawn, the common case for every
 * pre-loop-crear-jugar document) short-circuits to `undefined` with no error,
 * matching `label`'s optional-field validation shape.
 */
function validateSpawn(
  input: unknown,
  floorIds: ReadonlySet<string>,
  mapWidth: number,
  mapHeight: number,
): MapSpawn | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', '"spawn" must be an object when present.');
  }
  const raw = input as Record<string, unknown>;
  if (!Number.isInteger(raw.x) || (raw.x as number) < 0 || (raw.x as number) >= mapWidth) {
    throw new MapFormatError('malformed', `"spawn.x" must be an integer within [0, ${mapWidth}).`);
  }
  if (!Number.isInteger(raw.y) || (raw.y as number) < 0 || (raw.y as number) >= mapHeight) {
    throw new MapFormatError('malformed', `"spawn.y" must be an integer within [0, ${mapHeight}).`);
  }
  if (typeof raw.floor !== 'string' || !floorIds.has(raw.floor)) {
    throw new MapFormatError('malformed', '"spawn.floor" must reference an existing floor id.');
  }
  return { x: raw.x as number, y: raw.y as number, floor: raw.floor };
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

function validateLayers(
  input: unknown,
  width: number,
  height: number,
  label = 'layers',
): MapLayers {
  if (typeof input !== 'object' || input === null) {
    throw new MapFormatError('malformed', `"${label}" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  const size = width * height;

  if (!Array.isArray(raw.tiles) || raw.tiles.length !== 4) {
    throw new MapFormatError('malformed', `"${label}.tiles" must be an array of exactly 4 layers.`);
  }
  for (const layer of raw.tiles) {
    validateTileLayer(layer, size, `${label}.tiles[]`);
  }
  validateTileLayer(raw.shadows, size, `${label}.shadows`);
  validateTileLayer(raw.regions, size, `${label}.regions`);

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

/**
 * Transitional single-floor accessor for callers not yet floor-aware ahead
 * of the floor-aware gameplay/renderer/painter work (plantas-apiladas
 * Slices 2-4). Reads floor `[0]`'s layers; call sites that need real floor
 * selection move to the floor-aware entry points those slices introduce.
 */
export function primaryFloorLayers(doc: MapDocument): MapLayers {
  const floor = doc.floors[0];
  if (!floor) {
    throw new MapFormatError('malformed', 'Map document has no floors.');
  }
  return floor.layers;
}

/** Transitional single-floor writer counterpart to `primaryFloorLayers` -- see its doc comment. */
export function withPrimaryFloorLayers(doc: MapDocument, layers: MapLayers): MapDocument {
  const [first, ...rest] = doc.floors;
  if (!first) {
    throw new MapFormatError('malformed', 'Map document has no floors.');
  }
  return { ...doc, floors: [{ ...first, layers }, ...rest] };
}
