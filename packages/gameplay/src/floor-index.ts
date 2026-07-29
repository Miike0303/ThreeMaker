/**
 * A runtime floor INDEX is an index into the session's `floors` array, so it
 * must be a non-negative integer -- never a `.tmmap` document's floor ID
 * string (see `NpcDefinition.floor`). Both cross this boundary looking
 * equally plausible, and TypeScript stops helping the moment an untyped
 * document value gets there: an id would silently build keys like
 * `"floor-0:1,2"` that no floor-scoped lookup can ever match, so every
 * NPC/trigger on the map would simply go missing with no error anywhere.
 * Failing loudly here turns that into an obvious failure at the boundary.
 */
export function assertFloorIndex(floor: number, where: string): void {
  if (!Number.isInteger(floor) || floor < 0) {
    throw new Error(
      `${where}: floor must be a non-negative integer floor index, got ${JSON.stringify(floor)}. A ".tmmap" floor id must be resolved to its floor index first.`,
    );
  }
}
