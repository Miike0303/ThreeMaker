/**
 * Disposes every populated tileset-slot texture in one `FloorSource`'s
 * `textures` record (rpgm-whole-game-import fix, adversarial review): the
 * manifest 'g' map-cycle in `main.ts` calls `loadAuthoredMap` fresh per hop,
 * which allocates a brand-new set of `THREE.Texture` instances every time
 * (`authored-map.ts`'s `resolveTileset` -- there is no cross-hop cache, and
 * `buildFloorRender`'s `ownsTextures: false` means `session.dispose()` never
 * frees the outgoing set). `main.ts` calls this on the map it is leaving,
 * right after `session.dispose()` and before swapping in the newly-loaded
 * result's textures.
 *
 * Every floor in an `AuthoredMapResult` shares the SAME `textures` object
 * reference (`authored-map.ts`'s `loadAuthoredMap` spreads one shared
 * `textures` record across every `FloorSource`, since a document has exactly
 * one tileset) -- disposing `floorSources[0].textures` once is enough for
 * the whole result, never one call per floor.
 */
import type { TileSheetId } from '@threemaker/importer-rpgm';
import type * as THREE from 'three/webgpu';

/** A no-op for `undefined` (nothing loaded yet -- the very first map has no "previous" result to dispose) or an empty/falsy slot entry. */
export function disposeFloorTextures(
  textures: Partial<Record<TileSheetId, THREE.Texture>> | undefined,
): void {
  if (!textures) return;
  for (const texture of Object.values(textures)) {
    texture?.dispose();
  }
}
