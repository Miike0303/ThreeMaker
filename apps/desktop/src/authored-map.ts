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
 * loudly (port of `demo-content.ts:121-158`) and returns it as
 * `AuthoredMapResult.narrative` for the per-map bundle to compile and wire.
 * That validation THROWS -- unlike the fallback cases below, a dangling
 * narrative reference is a content bug and must never degrade to a silently
 * narrative-free map.
 *
 * Returns `null` (after logging why) whenever the caller should fall back to
 * the existing DEV demos/fixture path instead: no MAP DOCUMENT saved yet, or
 * that document fails to read/parse/validate (spec: "DEV demos remain
 * fallback"). Scope matters: only the map-document read degrades to `null`. A
 * SIDECAR read failure does not -- it joins the loud narrative rejections
 * above, because a map that authors narrative and then loses it is a broken
 * map, not a map without one (spec R4). A per-slot texture failure is handled
 * differently again (W1, below) -- it degrades that one slot, not the load.
 */

import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import type { EventCommand, ShowDialogueCommand } from '@threemaker/core';
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument, MapEventScripts, WorldSeedValue } from '@threemaker/map-format';
import { parseMapDocument } from '@threemaker/map-format';
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
 * story has a source in `inkSources`, and each `world_get` key those sources
 * read has a `worldSeeds` entry.
 */
export interface AuthoredMapNarrative {
  readonly npcs: readonly TranslatedNpc[];
  readonly triggers: readonly TranslatedTrigger[];
  readonly events: MapEventScripts;
  readonly worldSeeds: Readonly<Record<string, WorldSeedValue>>;
  /** Raw `.ink` source per story id, read from the `<map>.<storyId>.ink` sidecar next to the map (design D7). Compilation is the bundle's job, not this loader's. */
  readonly inkSources: ReadonlyMap<string, string>;
}

/** Full translator output, ready for `createMapSession(floorSources, stairLinks, {spawn})`. */
export interface AuthoredMapResult {
  readonly floorSources: readonly FloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: TranslatedSpawn | undefined;
  /** Cross-validated authored narrative, or `undefined` when this map authors none (spec R5: a content-free map gets no interpreter and behaves exactly as before). Required, never optional, so a future `AuthoredMapResult` producer cannot drop it silently. */
  readonly narrative: AuthoredMapNarrative | undefined;
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
  /** Resolves one tileset slot's `object` sha256 to a decoded texture. Rejects on a missing/unreadable object -- `resolveTileset` (below) is what catches that and substitutes the W1 placeholder, not this function. */
  readonly resolveObjectTexture: (sha256: string) => Promise<ResolvedTexture>;
  /**
   * Home-relative path of the map being loaded -- the base every
   * `<map>.<storyId>.ink` sidecar path is derived from (design D7). Optional
   * so the pre-existing callers keep compiling; it defaults to the shared
   * working map (`MAP_FILE_RELATIVE`), which is correct for the single-file
   * authored path.
   *
   * KNOWN GAP, deliberate and bounded: `main.ts`'s `loadAuthoredMapAt`
   * (manifest entries) does not pass it yet, so a manifest map's sidecars
   * would be looked for next to `current.tmmap.json`. That is unreachable
   * today -- an RPGM-converted map has an empty `events`, so zero sidecars are
   * ever required and no read happens at all. Task 6.4/6.6 supplies it when
   * the manifest path gets a narrative bundle.
   */
  readonly mapRelativePath?: string;
  /** Reads one `.ink` sidecar's text by home-relative path, `null` when it does not exist. Defaults to `map-file.ts`'s home-relative reader -- the same helper the map document itself is read through. */
  readonly readSidecarText?: (relativePath: string) => Promise<string | null>;
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

/** Suffix an authored map file carries; the sidecar base is the path without it. */
const MAP_FILE_SUFFIX = '.tmmap.json';

/**
 * Story ids that are safe to interpolate into a sidecar file name: one or more
 * letters, digits, `_` or `-`, and nothing else. A `.tmmap` is UNTRUSTED input
 * (these files get shared), and `sidecarPath` below turns a document-supplied
 * `storyId` straight into a home-relative fs path -- so `"../../../evil"`
 * would otherwise address `.threemaker/maps/current.../../../evil.ink`. The
 * Tauri capability also confines the read, but this gate is what keeps the
 * rejection a named authoring error rather than a scope denial.
 */
const SAFE_STORY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Sidecar path for one story of one map: `<dir>/<name>.tmmap.json` -> `<dir>/<name>.<storyId>.ink` (design D7, the demo's own `map007.elder.ink` convention). A path that does not end in the suffix keeps its whole name as the base. Callers MUST have validated `storyId` against `SAFE_STORY_ID_PATTERN` first. */
function sidecarPath(mapRelativePath: string, storyId: string): string {
  const base = mapRelativePath.endsWith(MAP_FILE_SUFFIX)
    ? mapRelativePath.slice(0, -MAP_FILE_SUFFIX.length)
    : mapRelativePath;
  return `${base}.${storyId}.ink`;
}

/** Matches an ink `world_get("key")` external call, capturing the key. Ported verbatim from `demo-content.ts`. */
const WORLD_GET_CALL_PATTERN = /world_get\(\s*"([^"]+)"\s*\)/g;

/** Recursively collects every `showDialogue` command, including branches nested inside `conditional` commands -- port of `demo-content.ts`'s `collectDialogueSources`. A nested reference is exactly as dangling as a top-level one. */
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
 * porting `demo-content.ts:121-158`'s loud-failure set (spec: "authored
 * content loads with loud cross-validation"):
 *
 * - every `showDialogue` ink `storyId` must be a safe file-name identifier
 *   (`SAFE_STORY_ID_PATTERN`), checked BEFORE any path is built from it;
 * - every `showDialogue` ink story (including inside `conditional` branches)
 *   must have a sidecar at `<map>.<storyId>.ink`, that read must succeed, and
 *   its contents must not be blank;
 * - every `npcs[].onInteract` and `triggers[].event` must name a real
 *   `events` key;
 * - every `world_get("key")` a sidecar reads (extracted by regex, not by
 *   compiling the story) must have a `worldSeeds` entry.
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

  const stories = [...requiredInkStories(doc.events)];

  // Charset gate FIRST, before a single `sidecarPath` call: the whole point is
  // that a hostile id never reaches the fs layer, not even to be denied there.
  for (const [storyId, eventKey] of stories) {
    if (!SAFE_STORY_ID_PATTERN.test(storyId)) {
      failNarrative(
        mapRelativePath,
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, which is not a usable story id -- only letters, digits, "_" and "-" are allowed, because the id becomes a sidecar file name.`,
      );
    }
  }

  const sources = await Promise.all(
    stories.map(async ([storyId, eventKey]) => {
      const path = sidecarPath(mapRelativePath, storyId);
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
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, but no sidecar exists at ${JSON.stringify(sidecarPath(mapRelativePath, storyId))}.`,
      );
    }
    // A blank sidecar would otherwise load "successfully" and fail far away,
    // inside the bundle's `compileInk` or at the first `Continue()`. Full
    // syntax validation stays deferred there by design (D1/D7); emptiness is
    // the one case this loader can name precisely and cheaply.
    if (source.trim() === '') {
      failNarrative(
        mapRelativePath,
        `event ${JSON.stringify(eventKey)} references ink story ${JSON.stringify(storyId)}, but its sidecar at ${JSON.stringify(sidecarPath(mapRelativePath, storyId))} is empty.`,
      );
    }
    inkSources.set(storyId, source);
  }

  for (const npc of doc.npcs) {
    if (!(npc.onInteract in doc.events)) {
      failNarrative(
        mapRelativePath,
        `npc ${JSON.stringify(npc.id)} references onInteract event ${JSON.stringify(npc.onInteract)}, but no such event exists.`,
      );
    }
  }

  for (const trigger of doc.triggers) {
    if (!(trigger.event in doc.events)) {
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
      if (key !== undefined && !(key in doc.worldSeeds)) {
        failNarrative(
          mapRelativePath,
          `ink sidecar ${JSON.stringify(sidecarPath(mapRelativePath, storyId))} calls world_get("${key}"), but no world seed exists for ${JSON.stringify(key)} -- seed it in the document's "worldSeeds".`,
        );
      }
    }
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
 * when the caller should fall back to the existing DEV demos/fixture path: no
 * map file saved yet, the map-document read itself throwing, or a
 * parse/validation failure -- each is logged so the reason is visible, and
 * none of them crash `main()`.
 *
 * THROWS, deliberately, for every authored-narrative failure `loadNarrative`
 * detects -- including a failed `.ink` SIDECAR read, which is not a
 * "fall back quietly" case (spec R4). Callers that swallow this turn a broken
 * map into a misleading "no authored map".
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

  let doc: MapDocument;
  try {
    doc = parseMapDocument(JSON.parse(rawText));
  } catch (error) {
    console.error('authored-map: the shared map file failed to parse/validate.', error);
    return null;
  }

  const translated = translateMapDocument(doc);
  // Deliberately BEFORE texture resolution: a dangling narrative reference is
  // a content bug that must fail loudly (spec: "MUST NOT degrade to a
  // silently narrative-free map"), so there is no reason to decode this map's
  // sheets first -- and ordering it here is what makes the load-time
  // `world_get` gate provably precede any dialogue.
  const narrative = await loadNarrative(doc, translated, deps);
  const { textures, sheetPixelSizes } = await resolveTileset(doc, deps);

  const floorSources: readonly FloorSource[] = translated.floorSources.map((source) => ({
    ...source,
    textures,
    sheetPixelSizes,
  }));

  return {
    floorSources,
    stairLinks: translated.stairLinks,
    spawn: translated.spawn,
    narrative,
  };
}
