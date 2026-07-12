/**
 * `computeRoomIdGrid` (techos-y-oclusion-interiores design, "computeRoomIdGrid
 * home"): pure function of a document's `rooms[]`, mirroring
 * `@threemaker/importer-rpgm`'s `computeHeightGrid` shape -- cheap enough to
 * recompute on load, no caching needed. Kept in `@threemaker/map-format`
 * (not `importer-rpgm`, which must not depend on this package) because
 * rooms are a document concept, not an RPGM-import concept.
 */
import type { RoomDocument } from './schema.js';

/**
 * Per-floor room-id grid, row-major (`width * height` entries, same
 * indexing as `MapLayers`). `0` = unauthored -- no room, never occludes,
 * never fades (locked decision: "Unauthored areas never occlude"). A
 * non-zero cell is the 1-based ordinal, in DOCUMENT ORDER among only the
 * rooms whose `floor` matches `floorId`, of the room occupying that cell.
 * When two rooms' rects overlap, the LATER room in that floor-scoped
 * document order wins (design: "roomIdGrid values ... overlap: later room
 * wins") -- rects are painted in order, so a later room's paint simply
 * overwrites an earlier room's.
 */
export function computeRoomIdGrid(
  rooms: readonly RoomDocument[],
  floorId: string,
  width: number,
  height: number,
): Uint16Array {
  const grid = new Uint16Array(width * height);
  const floorRooms = rooms.filter((room) => room.floor === floorId);

  floorRooms.forEach((room, floorScopedIndex) => {
    const roomId = floorScopedIndex + 1;
    for (const rect of room.rects) {
      const xEnd = Math.min(rect.x + rect.width, width);
      const yEnd = Math.min(rect.y + rect.height, height);
      for (let y = Math.max(rect.y, 0); y < yEnd; y++) {
        for (let x = Math.max(rect.x, 0); x < xEnd; x++) {
          grid[y * width + x] = roomId;
        }
      }
    }
  });

  return grid;
}
