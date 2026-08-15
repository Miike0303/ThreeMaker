/**
 * Pure `MapDocument` -> desktop-runtime-shape translator (loop-crear-jugar
 * design, "Translator home"). DOM/three-free: no Tauri fs, no texture
 * loading, and NOT wired into `main()`'s load path yet -- that wiring is a
 * later slice's job (`apps/desktop/src/authored-map.ts`). Mirrors the
 * editor's own `map-compose.ts` bridge (`toRenderableMap`/
 * `toRenderableTileset`) but targets this app's `FloorSource`/
 * `StairLinkRuntime` shapes (`floor-runtime.ts`) instead of the painter's.
 *
 * Per floor: `documentFloorToRpgm` builds the `RpgmMap`/`RpgmTileset`/
 * ramp-cell triple `buildChunks` already understands (shared with the
 * editor painter), and this translator derives a room-id grid via
 * `computeRoomIdGrid` when that floor has any authored rooms (omitted
 * otherwise, mirroring `rampCells`' "no ramp" omission convention -- see
 * `FloorSource`'s own doc comment).
 *
 * Stair-links and spawn reference floors by their stable string id
 * (`FloorDocument.id`); resolving that to a `floors` array index is this
 * app's job, not `@threemaker/gameplay`'s (see `apps/desktop/src/main.ts:537`'s
 * doc comment -- the original source of this contract, before `StairLinkRuntime`
 * moved to `floor-runtime.ts`). `resolveFloorIndex` below is the single place
 * that resolution happens.
 */

import { documentFloorToRpgm } from '@threemaker/importer-rpgm';
import type {
  FloorDocument,
  MapDocument,
  MapEventScripts,
  NpcDocument,
  StairLinkDocument,
  TriggerDocument,
  WorldSeedValue,
} from '@threemaker/map-format';
import { computeRoomIdGrid } from '@threemaker/map-format';
import type { FloorSource, StairLinkRuntime } from './floor-runtime.js';

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

/**
 * One authored NPC with its document floor ID resolved to a runtime floor
 * INDEX -- the domain `NpcDefinition.floor` (`@threemaker/gameplay`) requires
 * and `assertFloorIndex` enforces. `sprite` deliberately stays the document's
 * content-addressed `{object, characterIndex}` ref: turning a sha256 into a
 * loaded sheet needs texture IO, which is the per-map narrative bundle's job
 * (design D5), not this pure step's.
 */
export type TranslatedNpc = Omit<NpcDocument, 'floor'> & { readonly floor: number };

/** One authored trigger with its document floor ID resolved to a runtime floor INDEX (`TriggerDefinition.floor`'s domain). */
export type TranslatedTrigger = Omit<TriggerDocument, 'floor'> & { readonly floor: number };

/** Full translator output, consumed downstream by `createMapSession(floorSources, stairLinks, {spawn})` (a later slice's wiring -- see this module's own doc comment). */
export interface TranslatedMapDocument {
  readonly floorSources: readonly TranslatedFloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: TranslatedSpawn | undefined;
  /**
   * Authored narrative content (schema v4), carried through with every floor
   * reference resolved. Nothing consumes these yet -- the per-map narrative
   * bundle does (design D1) -- but dropping them here would be an invisible
   * data loss: this function returns its own shape, so the compiler cannot
   * report an unmirrored document field (spec R3's one test-guarded row).
   */
  readonly npcs: readonly TranslatedNpc[];
  readonly triggers: readonly TranslatedTrigger[];
  readonly events: MapEventScripts;
  readonly worldSeeds: Readonly<Record<string, WorldSeedValue>>;
}

/** Resolves a `FloorDocument.id` reference to its position in `doc.floors` (array order = stacking order = `StairLinkRuntime`/spawn/NPC/trigger's numeric floor index). Throws on an unresolvable id -- `parseMapDocument`'s schema validation already guarantees every stair-link/spawn/npc/trigger floor reference exists in a valid document, so this only ever fires on a document that skipped validation. Failing loudly here still matters: for narrative entries a surviving id string becomes a floor-scoped registry key that can never match, so the entry would silently disappear instead of erroring. */
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
  const { map, tileset, rampCells } = documentFloorToRpgm(doc, floor);
  const hasRooms = doc.rooms.some((room) => room.floor === floor.id);

  return {
    floorId: floor.id,
    baseElevation: floor.baseElevation,
    map,
    tileset,
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
 * Resolves one authored NPC's floor ID to its floor index. The document's
 * `floor` is an ID string and the runtime's is an array index (same field
 * name, different type), so this is the single conversion point for NPCs --
 * an unresolved ID must never survive it: `NpcRegistry` would key the entry
 * `"floor-0:x,y"` and every floor-scoped lookup would silently miss, making
 * the NPC vanish with no error. `resolveFloorIndex` throws naming both the
 * NPC id and the missing floor id.
 */
function translateNpc(doc: MapDocument, npc: NpcDocument): TranslatedNpc {
  return { ...npc, floor: resolveFloorIndex(doc, npc.floor, `npcs[${npc.id}].floor`) };
}

/** Resolves one authored trigger's floor ID to its floor index -- same ID-vs-index boundary as `translateNpc`, with `TriggerIndex` as the silent-miss victim. */
function translateTrigger(doc: MapDocument, trigger: TriggerDocument): TranslatedTrigger {
  return {
    ...trigger,
    floor: resolveFloorIndex(doc, trigger.floor, `triggers[${trigger.id}].floor`),
  };
}

/**
 * Translates a valid `.tmmap` v4 `MapDocument` into desktop's runtime
 * shapes: one `TranslatedFloorSource` per floor (array order preserved,
 * matching `floors` stacking order), every `StairLinkDocument` resolved to
 * a `StairLinkRuntime`, the authored spawn resolved (or `undefined`), and the
 * authored narrative content carried through with each entry's floor ID
 * resolved to its floor index.
 * Pure -- same output for the same input, no IO, no three.js/DOM access.
 */
export function translateMapDocument(doc: MapDocument): TranslatedMapDocument {
  return {
    floorSources: doc.floors.map((floor) => translateFloor(doc, floor)),
    stairLinks: doc.stairLinks.map((link) => translateStairLink(doc, link)),
    spawn: translateSpawn(doc),
    npcs: doc.npcs.map((npc) => translateNpc(doc, npc)),
    triggers: doc.triggers.map((trigger) => translateTrigger(doc, trigger)),
    events: doc.events,
    worldSeeds: doc.worldSeeds,
  };
}
