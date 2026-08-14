/** World-space center of a tile coordinate. The single source of the tile-origin convention: change it here and every consumer (sprite, camera) stays in lockstep. */
export function tileCenterToWorld(tileCoord: number, tileWorldSize = 1): number {
  return (tileCoord + 0.5) * tileWorldSize;
}
