/**
 * Shared painter overlay projection for floor-scoped entities placed on one
 * tile (NPCs, props, triggers). Pure: returns each entity's tile-space
 * position on the given floor, in document order, for `painter-viewport.ts`
 * to project to screen space. Several entities may share a tile.
 */

export interface FloorOverlayPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

interface FloorPlacedEntity extends FloorOverlayPoint {
  readonly floor: string;
}

export function computeFloorOverlayPoints(
  entities: readonly FloorPlacedEntity[],
  floorId: string,
): readonly FloorOverlayPoint[] {
  return entities
    .filter((entity) => entity.floor === floorId)
    .map((entity) => ({ id: entity.id, x: entity.x, y: entity.y }));
}
