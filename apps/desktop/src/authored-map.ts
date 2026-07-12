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
 * Returns `null` (after logging why) whenever the caller should fall back to
 * the existing DEV demos/fixture path instead: no file saved yet, the file
 * fails to parse/validate, or the read itself throws (spec: "DEV demos
 * remain fallback"). A per-slot texture failure is handled differently
 * (W1, below) -- it degrades that one slot, not the whole load.
 */

import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type { MapDocument } from '@threemaker/map-format';
import { parseMapDocument } from '@threemaker/map-format';
import type { SheetPixelSizes } from '@threemaker/renderer';
import { loadSheetTexture } from '@threemaker/renderer';
import * as THREE from 'three/webgpu';
import type { FloorSource, StairLinkRuntime } from './floor-runtime.js';
import type { TranslatedSpawn } from './map-document-runtime.js';
import { translateMapDocument } from './map-document-runtime.js';
import { readMapDocumentText } from './map-file.js';

/** Full translator output, ready for `createMapSession(floorSources, stairLinks, {spawn})`. */
export interface AuthoredMapResult {
  readonly floorSources: readonly FloorSource[];
  readonly stairLinks: readonly StairLinkRuntime[];
  readonly spawn: TranslatedSpawn | undefined;
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

/**
 * Attempts to load the shared authored map file end to end. Returns `null`
 * when the caller should fall back to the existing DEV demos/fixture path
 * (no file saved yet, parse/validation failure, or the read itself
 * throwing) -- every one of those is logged so the reason is visible, but
 * none of them crash `main()`.
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
  const { textures, sheetPixelSizes } = await resolveTileset(doc, deps);

  const floorSources: readonly FloorSource[] = translated.floorSources.map((source) => ({
    ...source,
    textures,
    sheetPixelSizes,
  }));

  return { floorSources, stairLinks: translated.stairLinks, spawn: translated.spawn };
}
