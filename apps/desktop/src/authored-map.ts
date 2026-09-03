/**
 * Authored-map load path (loop-crear-jugar design, "Desktop load gating" +
 * "texture resolution"): reads the shared working map file
 * (`map-file.ts`'s `readMapDocumentText`), parses/validates it
 * (`@threemaker/map-format`), translates it into per-floor runtime shapes
 * (`map-document-runtime.ts`'s `translateMapDocument`), and resolves each
 * populated tileset slot's `object` sha256 reference into a real texture --
 * merging the two translator-omitted `FloorSource` fields
 * (`textures`/`sheetPixelSizes`, see `map-document-runtime.ts`'s own doc
 * comment) into a full `FloorSource[]` ready for `createMapSession`.
 *
 * Since C1a it also loads this map's `.ink` sidecars by name
 * (`<map>.<storyId>.ink`, design D7), cross-validates the authored narrative
 * loudly (ported from the since-deleted `demo-content.ts`) and returns it as
 * `AuthoredMapResult.narrative` for the per-map bundle to compile and wire.
 * That validation THROWS -- unlike the fallback cases below, a dangling
 * narrative reference is a content bug and must never degrade to a silently
 * narrative-free map.
 *
 * Returns `null` (after logging why) whenever the caller should fall back to
 * the existing DEV fixture path: no MAP DOCUMENT saved yet, or the document
 * file itself failed to read. Parse/validate failures THROW -- a broken file
 * is not "no authored map". A SIDECAR read failure also throws (spec R4).
 * A per-slot texture failure degrades that one slot, not the load (W1).
 */

import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import type { CommandRegistry, EventCommand, ShowDialogueCommand } from '@threemaker/core';
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type {
  LightDocument,
  MapDocument,
  MapEventScripts,
  PropDocument,
  WorldSeedValue,
} from '@threemaker/map-format';
import { inkSidecarRelativePath, isSafeStoryId, parseMapDocument } from '@threemaker/map-format';
import type { SheetPixelSizes } from '@threemaker/renderer';
import { loadSheetTexture } from '@threemaker/renderer';
import * as THREE from 'three/webgpu';
import type { FloorSource, StairLinkRuntime } from './floor-runtime.js';
import type {
  TranslatedMapDocument,
  TranslatedNpc,
  TranslatedSpawn,
  TranslatedTrigger,
} from './map-document-runtime.js';
import { translateMapDocument } from './map-document-runtime.js';
import { MAP_FILE_RELATIVE, readMapDocumentText } from './map-file.js';

/**
 * One authored map's cross-validated narrative content, ready for the per-map
 * narrative bundle (C1a design D1) to compile and wire. Every reference in
 * here is already proven to resolve: each `npcs[].onInteract` and
 * `triggers[].event` names a real key of `events`, each `showDialogue` ink
 * story has a source in `inkSources`, each `world_get` key those sources
 * read has a `worldSeeds` entry, and every `giveItem`/`modifyStat`/item-or-
 * stat conditional id (plus ink `item_count`/`stat_get`) is present in the
 * session game-defs catalog when one is loaded.
 */
export interface AuthoredMapNarrative {
  readonly npcs: readonly TranslatedNpc[];
  readonly triggers: readonly TranslatedTrigger[];
  readonly events: MapEventScripts;
  readonly worldSeeds: Readonly<Record<string, WorldSeedValue>>;
  /** Raw `.ink` source per story id, read from the `<map>.<storyId>.ink` sidecar next to the map (design D7). Compilation is the bundle's job, not this loader's. */
  readonly inkSources: ReadonlyMap<string, string>;
}

/**
 * Session game-defs id sets used at load time to cross-validate authored
 * `giveItem`/`modifyStat`/item-stat conditionals and ink `item_count`/
 * `stat_get` calls. Empty sets (default) accept maps that use none of those
 * features; any usage of an unknown id fails loudly.
 */
export interface GameDefsCatalog {
  readonly itemIds: ReadonlySet<string>;
  readonly statIds: ReadonlySet<string>;
}

/** Empty catalog: zero known items/stats. Valid with zero item/stat usage. */
export const EMPTY_GAME_DEFS_CATALOG: GameDefsCatalog = {
  itemIds: new Set(),
  statIds: new Set(),
};

/** Full translator output, ready for `createMapSession(floorSources, stairLinks, {spawn})`. */
export interface AuthoredMapResult {
  readonly floorSources: readonly FloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: TranslatedSpawn | undefined;
  /** Cross-validated authored narrative, or `undefined` when this map authors none (spec R5: a content-free map gets no interpreter and behaves exactly as before). Required, never optional, so a future `AuthoredMapResult` producer cannot drop it silently. */
  readonly narrative: AuthoredMapNarrative | undefined;
  /**
   * Validated schema-v5 props (empty when the map authors none). No re-validation
   * here — `parseMapDocument` already checked ids/floors/sha/scale/animation.
   * Required so a future producer cannot drop props silently.
   */
  readonly props: readonly PropDocument[];
  /**
   * Validated schema-v6 lights (empty when the map authors none). Required so a
   * future producer cannot drop lights silently — same discipline as `props`.
   */
  readonly lights: readonly LightDocument[];
}

/** One resolved sheet: the decoded texture plus its pixel size (`buildChunks` needs both). */
interface ResolvedTexture {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
}

/**
 * Injectable seams -- the real implementations (`DEFAULT_DEPS`, below) touch
 * Tauri fs and decode real image bytes, neither of which works in this
 * package's `vitest` (`environment: 'node'`) runs; unit tests substitute
 * fakes here instead, same pattern as `map-file.test.ts`'s mocked
 * `@tauri-apps/plugin-fs`.
 */
export interface AuthoredMapDeps {
  readonly readMapDocumentText: () => Promise<string | null>;
  /**
   * Plugin-contributed command types accepted in this document's `events`.
   * Must be the same registry the `EventInterpreter` is built with, or an
   * authored plugin command validates here and then has no handler at play
   * time. Omitted → only core's builtin commands are accepted.
   */
  readonly plugins?: CommandRegistry;
  /** Resolves one tileset slot's `object` sha256 to a decoded texture. Rejects on a missing/unreadable object -- `resolveTileset` (below) is what catches that and substitutes the W1 placeholder, not this function. */
  readonly resolveObjectTexture: (sha256: string) => Promise<ResolvedTexture>;
  /**
   * Home-relative path of the map being loaded -- the base every
   * `<map>.<storyId>.ink` sidecar path is derived from (design D7). Optional
   * so the pre-existing callers keep compiling; it defaults to the shared
   * working map (`MAP_FILE_RELATIVE`), which is correct for the single-file
   * authored path.
   *
   * Optional in TYPE ONLY -- every caller in `main.ts` passes it, and a manifest
   * map depends on it: `loadAuthoredMapAt` builds `${MAP_DIR_RELATIVE}/${entry
   * .file}` so each converted map's sidecars are resolved next to THAT map,
   * never next to the shared `current.tmmap.json`. Omitting it silently
   * relocates every sidecar lookup of that map, which surfaces as a "no sidecar
   * exists" rejection naming the wrong directory -- so a NEW caller must pass
   * its own map's path rather than inherit the default.
   */
  readonly mapRelativePath?: string;
  /** Reads one `.ink` sidecar's text by home-relative path, `null` when it does not exist. Defaults to `map-file.ts`'s home-relative reader -- the same helper the map document itself is read through. */
  readonly readSidecarText?: (relativePath: string) => Promise<string | null>;
  /**
   * Loaded game-defs item/stat ids for catalog cross-validation (C4).
   * Defaults to {@link EMPTY_GAME_DEFS_CATALOG} (no ids valid) so maps that
   * never use items/stats still load, and any unknown id fails loudly.
   */
  readonly gameDefsCatalog?: GameDefsCatalog;
}

const ASSET_STORE_OBJECTS_DIR = '.threemaker/asset-store/objects';

/** Reads one asset-store object's bytes via Tauri fs and decodes it into a texture (mirrors `catalog-client.ts`'s `objectPreviewUrl` path convention: `objects/{sha256[:2]}/{sha256}`, but reads bytes directly rather than going through `convertFileSrc` -- desktop has no `<img>`, only `THREE.Texture` consumers). */
async function resolveObjectTextureReal(sha256: string): Promise<ResolvedTexture> {
  const bytes = await readFile(`${ASSET_STORE_OBJECTS_DIR}/${sha256.slice(0, 2)}/${sha256}`, {
    baseDir: BaseDirectory.Home,
  });
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const texture = await loadSheetTexture(blobUrl);
    const image = texture.image as { width: number; height: number };
    return { texture, width: image.width, height: image.height };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const DEFAULT_DEPS: AuthoredMapDeps = {
  readMapDocumentText,
  resolveObjectTexture: resolveObjectTextureReal,
  mapRelativePath: MAP_FILE_RELATIVE,
  // Same home-relative reader, pointed at a sidecar instead of the document:
  // `.ink` sidecars live in the same directory, same trust domain, same
  // `BaseDirectory.Home` root (design's threat-matrix N/A rationale).
  readSidecarText: readMapDocumentText,
};

const PLACEHOLDER_SIZE = 32;

/**
 * [W1] Fail-soft substitute for a missing/corrupt asset-store object: a
 * flat, visibly-wrong magenta texture (the "missing texture" convention),
 * built entirely in-memory (`THREE.DataTexture`, no fs/network) so it can
 * never itself fail. Degrades that one slot's tiles to obviously-wrong
 * rather than crashing the whole authored-map load.
 */
function buildPlaceholderTexture(): ResolvedTexture {
  const data = new Uint8Array(PLACEHOLDER_SIZE * PLACEHOLDER_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 217;
    data[i + 1] = 0;
    data[i + 2] = 217;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  texture.needsUpdate = true;
  return { texture, width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE };
}

/**
 * Resolves every populated slot of a document's tileset (shared across every
 * floor -- a document has exactly one tileset, see
 * `map-document-runtime.ts`'s `toDocTileset` doc comment) to a texture +
 * pixel size. A slot with no authored `object` is simply skipped (mirrors
 * `main.ts`'s `loadUsedSheetTextures`' "unused/empty sheet slots" skip).
 *
 * [W1] A slot whose object IS authored but fails to resolve (missing file,
 * corrupt bytes, any `resolveObjectTexture` rejection) never aborts this
 * function or the overall load -- it's logged clearly and substituted with
 * `buildPlaceholderTexture()` instead.
 */
async function resolveTileset(
  doc: MapDocument,
  deps: AuthoredMapDeps,
): Promise<{
  readonly textures: Partial<Record<TileSheetId, THREE.Texture>>;
  readonly sheetPixelSizes: SheetPixelSizes;
}> {
  const textures: Partial<Record<TileSheetId, THREE.Texture>> = {};
  const sheetPixelSizes: SheetPixelSizes = {};

  const slotEntries = Object.entries(doc.tileset.slots) as [
    TileSheetId,
    { readonly object?: string } | undefined,
  ][];

  await Promise.all(
    slotEntries.map(async ([slot, source]) => {
      if (!source?.object) return;
      let resolved: ResolvedTexture;
      try {
        resolved = await deps.resolveObjectTexture(source.object);
      } catch (error) {
        console.error(
          `authored-map: tileset slot "${slot}" references object ${source.object}, which is missing or unreadable; using a placeholder texture.`,
          error,
        );
        resolved = buildPlaceholderTexture();
      }
      textures[slot] = resolved.texture;
      sheetPixelSizes[slot] = { width: resolved.width, height: resolved.height };
    }),
  );

  return { textures, sheetPixelSizes };
}

/** Ink sidecar path + SAFE_STORY_ID live in `@threemaker/map-format`. */

/** Matches an ink `world_get("key")` external call, capturing the key. Ported verbatim from the since-deleted `demo-content.ts`. */
const WORLD_GET_CALL_PATTERN = /world_get\(\s*"([^"]+)"\s*\)/g;

/** Matches an ink `item_count("id")` external call, capturing the item id. */
const ITEM_COUNT_CALL_PATTERN = /item_count\(\s*"([^"]+)"\s*\)/g;

/** Matches an ink `stat_get("id")` external call, capturing the stat id. */
const STAT_GET_CALL_PATTERN = /stat_get\(\s*"([^"]+)"\s*\)/g;

/** Recursively collects every `showDialogue` command, including branches nested inside `conditional` commands -- ported from the since-deleted `demo-content.ts`'s `collectDialogueSources`. A nested reference is exactly as dangling as a top-level one. */
function collectDialogueSources(commands: readonly EventCommand[]): ShowDialogueCommand[] {
  const result: ShowDialogueCommand[] = [];
  for (const command of commands) {
    if (command.type === 'showDialogue') {
      result.push(command);
    } else if (command.type === 'conditional') {
      result.push(...collectDialogueSources(command.then));
      if (command.else) result.push(...collectDialogueSources(command.else));
    }
  }
  return result;
}

/**
 * Walks event commands (including nested `then`/`else`) and fails when a
 * `giveItem`/`modifyStat` or item/stat-sourced conditional names an id
 * absent from the loaded game-defs catalog.
 */
function assertCatalogCommandRefs(
  commands: readonly EventCommand[],
  eventKey: string,
  catalog: GameDefsCatalog,
  mapRelativePath: string,
): void {
  for (const command of commands) {
    if (command.type === 'giveItem') {
      if (!catalog.itemIds.has(command.itemId)) {
        failNarrative(
          mapRelativePath,
          `event ${JSON.stringify(eventKey)} giveItem references unknown item id ${JSON.stringify(command.itemId)}.`,
        );
      }
    } else if (command.type === 'modifyStat') {
      if (!catalog.statIds.has(command.statId)) {
        failNarrative(
          mapRelativePath,
          `event ${JSON.stringify(eventKey)} modifyStat references unknown stat id ${JSON.stringify(command.statId)}.`,
        );
      }
    } else if (command.type === 'conditional') {
      const source = command.if.source ?? 'world';
      if (source === 'item' && !catalog.itemIds.has(command.if.key)) {
        failNarrative(
          mapRelativePath,
          `event ${JSON.stringify(eventKey)} conditional source "item" references unknown item id ${JSON.stringify(command.if.key)}.`,
        );
      }
      if (source === 'stat' && !catalog.statIds.has(command.if.key)) {
        failNarrative(
          mapRelativePath,
          `event ${JSON.stringify(eventKey)} conditional source "stat" references unknown stat id ${JSON.stringify(command.if.key)}.`,
        );
      }
      assertCatalogCommandRefs(command.then, eventKey, catalog, mapRelativePath);
      if (command.else) {
        assertCatalogCommandRefs(command.else, eventKey, catalog, mapRelativePath);
      }
    }
  }
}

/**
 * Every ink story id the document's events reference, in first-seen order,
 * each paired with the event key that referenced it first (the failure
 * message needs both). DERIVED from `events` rather than declared by a
 * schema field, per design D7 -- one less v4 field to mirror across spec R3's
 * six fan-out paths. A `text` dialogue source contributes nothing: it needs
 * no sidecar.
 */
function requiredInkStories(events: MapEventScripts): ReadonlyMap<string, string> {
  const stories = new Map<string, string>();
  for (const [eventKey, commands] of Object.entries(events)) {
    for (const command of collectDialogueSources(commands)) {
      if (command.source.kind !== 'ink') continue;
      if (!stories.has(command.source.storyId)) stories.set(command.source.storyId, eventKey);
    }
  }
  return stories;
}

/** Loud narrative rejection, always naming the map it came from -- a bare "story not found" is undiagnosable once more than one map is authored. */
function failNarrative(mapRelativePath: string, message: string): never {
  throw new Error(`Invalid authored narrative in ${JSON.stringify(mapRelativePath)}: ${message}`);
}

/** The message of a thrown value, for embedding one underlying fs/IO cause in a `failNarrative` message (a non-`Error` throw still has to be reported, not swallowed). */
function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads this map's `.ink` sidecars and cross-validates its authored content,
 * porting the since-deleted `demo-content.ts`'s loud-failure set (spec: "authored
 * content loads with loud cross-validation"):
 *
 * - every `showDialogue` ink `storyId` must be a safe file-name identifier
 *   (`isSafeStoryId`), checked BEFORE any path is built from it;
 * - every `showDialogue` ink story (including inside `conditional` branches)
 *   must have a sidecar at `<map>.<storyId>.ink`, that read must succeed, and
 *   its contents must not be blank;
 * - every `npcs[].onInteract` and `triggers[].event` must name a real
 *   `events` key;
 * - every `world_get("key")` a sidecar reads (extracted by regex, not by
 *   compiling the story) must have a `worldSeeds` entry;
 * - every `giveItem`/`modifyStat` and item/stat-sourced conditional (including
 *   nested `then`/`else`) must name an id in the session game-defs catalog;
 * - every `item_count("id")` / `stat_get("id")` a sidecar reads must name an
 *   id in that catalog's items / stats respectively.
 *
 * Returns `undefined` for a map that authors no narrative at all, so a plain
 * imported map gets no interpreter (spec R5). Never degrades a REFERENCE
 * failure to that quiet `undefined`: it throws, and because `loadAuthoredMap`
 * runs entirely before `main.ts`'s swap sequence reaches `session.dispose()`,
 * that throw can only ever leave the current session standing (design:
 * "all loud validation completes BEFORE the swap's point of no return").
 *
 * Compilation is deliberately NOT here: `compileInk`/`bindStoryToWorld` need
 * the session-scoped `WorldState` the narrative root owns, so they belong to
 * the per-map bundle (design D1/D7). This step guarantees every referenced
 * story's source is present for it.
 */
async function loadNarrative(
  doc: MapDocument,
  translated: TranslatedMapDocument,
  deps: AuthoredMapDeps,
): Promise<AuthoredMapNarrative | undefined> {
  const hasContent =
    doc.npcs.length > 0 || doc.triggers.length > 0 || Object.keys(doc.events).length > 0;
  if (!hasContent) return undefined;

  const mapRelativePath = deps.mapRelativePath ?? MAP_FILE_RELATIVE;
  const readSidecarText = deps.readSidecarText ?? readMapDocumentText;
  const catalog = deps.gameDefsCatalog ?? EMPTY_GAME_DEFS_CATALOG;

  const stories = [...requiredInkStories(doc.events)];

  // Charset gate FIRST, before a single `inkSidecarRelativePath` call: the whole point is
  // that a hostile id never reaches the fs layer, not even to be denied there.
  for (const [storyId, eventKey] of stories) {
    if (!isSafeStoryId(storyId)) {
      failNarrative(
        mapRelativePath,
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, which is not a usable story id -- only letters, digits, "_" and "-" are allowed, because the id becomes a sidecar file name.`,
      );
    }
  }

  const sources = await Promise.all(
    stories.map(async ([storyId, eventKey]) => {
      const path = inkSidecarRelativePath(mapRelativePath, storyId);
      try {
        return await readSidecarText(path);
      } catch (error) {
        // NOT degraded to `null`/`undefined` (spec R4: never a silently
        // narrative-free map): an fs-scope denial, a locked file or transient
        // IO is exactly as loud as a dangling reference, and says which.
        failNarrative(
          mapRelativePath,
          `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, but reading its sidecar at ${JSON.stringify(path)} failed: ${describeCause(error)}`,
        );
      }
    }),
  );

  const inkSources = new Map<string, string>();
  for (const [index, [storyId, eventKey]] of stories.entries()) {
    const source = sources[index];
    if (source === undefined || source === null) {
      failNarrative(
        mapRelativePath,
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, but no sidecar exists at ${JSON.stringify(inkSidecarRelativePath(mapRelativePath, storyId))}.`,
      );
    }
    // A blank sidecar would otherwise load "successfully" and fail far away,
    // inside the bundle's `compileInk` or at the first `Continue()`. Full
    // syntax validation stays deferred there by design (D1/D7); emptiness is
    // the one case this loader can name precisely and cheaply.
    if (source.trim() === '') {
      failNarrative(
        mapRelativePath,
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, but its sidecar at ${JSON.stringify(inkSidecarRelativePath(mapRelativePath, storyId))} is empty.`,
      );
    }
    inkSources.set(storyId, source);
  }

  for (const npc of doc.npcs) {
    // Object.hasOwn: `in` is true for Object.prototype names (`toString`, …)
    // even when the document never authored that event key (C1a follow-up).
    if (!Object.hasOwn(doc.events, npc.onInteract)) {
      failNarrative(
        mapRelativePath,
        `npc ${JSON.stringify(npc.id)} references onInteract event ${JSON.stringify(npc.onInteract)}, but no such event exists.`,
      );
    }
  }

  for (const trigger of doc.triggers) {
    if (!Object.hasOwn(doc.events, trigger.event)) {
      failNarrative(
        mapRelativePath,
        `trigger ${JSON.stringify(trigger.id)} references event ${JSON.stringify(trigger.event)}, but no such event exists.`,
      );
    }
  }

  // Static scan, kept as a load-time gate because `world_get` on an unseeded
  // key hard-throws MID-DIALOGUE at runtime (`story-runtime.ts`'s
  // fail-loudly-on-unset-key contract). That runtime check stays the second,
  // independent defense: this one cannot see keys built from dynamic ink
  // expressions rather than a literal string argument.
  for (const [storyId, source] of inkSources) {
    for (const match of source.matchAll(WORLD_GET_CALL_PATTERN)) {
      const key = match[1];
      if (key !== undefined && !Object.hasOwn(doc.worldSeeds, key)) {
        failNarrative(
          mapRelativePath,
          `ink sidecar ${JSON.stringify(inkSidecarRelativePath(mapRelativePath, storyId))} calls world_get("${key}"), but no world seed exists for ${JSON.stringify(key)} -- seed it in the document's "worldSeeds".`,
        );
      }
    }
    for (const match of source.matchAll(ITEM_COUNT_CALL_PATTERN)) {
      const itemId = match[1];
      if (itemId !== undefined && !catalog.itemIds.has(itemId)) {
        failNarrative(
          mapRelativePath,
          `ink sidecar ${JSON.stringify(inkSidecarRelativePath(mapRelativePath, storyId))} calls item_count("${itemId}"), but no game-defs item exists for ${JSON.stringify(itemId)}.`,
        );
      }
    }
    for (const match of source.matchAll(STAT_GET_CALL_PATTERN)) {
      const statId = match[1];
      if (statId !== undefined && !catalog.statIds.has(statId)) {
        failNarrative(
          mapRelativePath,
          `ink sidecar ${JSON.stringify(inkSidecarRelativePath(mapRelativePath, storyId))} calls stat_get("${statId}"), but no game-defs stat exists for ${JSON.stringify(statId)}.`,
        );
      }
    }
  }

  // Catalog cross-check for event commands (C4): walk every script including
  // nested conditionals. Maps that never use items/stats load with an empty
  // catalog (back-compat).
  for (const [eventKey, commands] of Object.entries(doc.events)) {
    assertCatalogCommandRefs(commands, eventKey, catalog, mapRelativePath);
  }

  return {
    npcs: translated.npcs,
    triggers: translated.triggers,
    events: doc.events,
    worldSeeds: doc.worldSeeds,
    inkSources,
  };
}

/**
 * Attempts to load the shared authored map file end to end. Returns `null`
 * only when there is no map file yet (`readMapDocumentText` yields `null`)
 * or the read itself throws -- the caller may fall back to the DEV fixture.
 *
 * THROWS for parse/validate failures and for every authored-narrative
 * failure `loadNarrative` detects (including a failed `.ink` sidecar).
 * Callers that swallow those turn a broken map into a misleading
 * "no authored map" / demo fixture.
 */
export async function loadAuthoredMap(
  deps: AuthoredMapDeps = DEFAULT_DEPS,
): Promise<AuthoredMapResult | null> {
  let rawText: string | null;
  try {
    rawText = await deps.readMapDocumentText();
  } catch (error) {
    console.error('authored-map: failed to read the shared map file.', error);
    return null;
  }
  if (rawText === null) return null;

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`authored-map: the shared map file is not valid JSON (${detail}).`);
  }
  const doc = parseMapDocument(json, deps.plugins);

  const translated = translateMapDocument(doc);
  // Deliberately BEFORE texture resolution: a dangling narrative reference is
  // a content bug that must fail loudly (spec: "MUST NOT degrade to a
  // silently narrative-free map"), so there is no reason to decode this map's
  // sheets first -- and ordering it here is what makes the load-time
  // `world_get` gate provably precede any dialogue.
  const narrative = await loadNarrative(doc, translated, deps);
  const { textures, sheetPixelSizes } = await resolveTileset(doc, deps);
  // Per-floor baked lightmaps (schema v6): resolve through the same object
  // seam as NPC sheets / tileset slots. Missing object → loud reject (content
  // bug), not a silent dark floor — same failure surface as a missing NPC
  // sheet path that aborts after console diagnostics when the seam throws
  // and the caller does not catch.
  const lightMapTextures = await resolveFloorLightMaps(doc, deps);

  const floorSources: readonly FloorSource[] = translated.floorSources.map((source, index) => {
    const floorDoc = doc.floors[index];
    const lightMapSha = floorDoc?.lightMap;
    const lightMapTexture =
      lightMapSha !== undefined ? lightMapTextures.get(lightMapSha) : undefined;
    return {
      ...source,
      textures,
      sheetPixelSizes,
      tilePixelSize: doc.tileset.tilePixelSize,
      ...(lightMapSha !== undefined ? { lightMap: lightMapSha } : {}),
      ...(lightMapTexture !== undefined ? { lightMapTexture } : {}),
    };
  });

  return {
    floorSources,
    stairLinks: translated.stairLinks,
    spawn: translated.spawn,
    narrative,
    // Schema-validated; floor ids still strings (map-props resolves against FloorGameplay.floorId).
    props: doc.props,
    // Schema-validated lights (map-lights enforces budget + runtime attach).
    lights: doc.lights,
  };
}

/**
 * The DEV Roseliam fixture is only for "no authored map file yet".
 * A parse/validate/narrative failure must stay on screen — loading the
 * demo after `statusEl.remove()` hid the error and looked like Play worked.
 */
export function shouldLoadDevFixture(authoredFailure: string | undefined, isDev: boolean): boolean {
  return isDev && authoredFailure === undefined;
}

/**
 * Resolves every distinct per-floor `lightMap` sha once. Throws when the
 * asset store cannot serve the object — baked lighting is intentional content
 * and must not degrade to a silently unlit floor.
 */
async function resolveFloorLightMaps(
  doc: MapDocument,
  deps: AuthoredMapDeps,
): Promise<Map<string, THREE.Texture>> {
  const shas = [
    ...new Set(
      doc.floors
        .map((floor) => floor.lightMap)
        .filter((sha): sha is string => typeof sha === 'string'),
    ),
  ];
  const resolved = new Map<string, THREE.Texture>();
  await Promise.all(
    shas.map(async (sha256) => {
      try {
        const { texture } = await deps.resolveObjectTexture(sha256);
        resolved.set(sha256, texture);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(
          `authored-map: floor lightMap object ${sha256} is missing or unreadable: ${cause}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
    }),
  );
  return resolved;
}
