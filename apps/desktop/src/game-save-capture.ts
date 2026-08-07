/**
 * Pure capture of runtime progress into a {@link GameSaveSnapshot} (C3/C4).
 * Host supplies already-read fields; this only copies and normalizes.
 */

import type { GameSaveSnapshot, SaveFacing, SaveWorldValue } from '@threemaker/save';

export type GameSaveCaptureInput = {
  /** Path relative to `.threemaker/maps` (manifest entry or `current.tmmap.json`). */
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly facing: SaveFacing;
  readonly world: Readonly<Record<string, SaveWorldValue>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly stats: Readonly<Record<string, number>>;
};

const FACINGS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

function copyPositiveInventory(
  inventory: Readonly<Record<string, number>>,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [itemId, count] of Object.entries(inventory)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      return undefined;
    }
    // Zeros invalid on disk — drop at capture (Inventory.snapshot already omits them).
    if (count > 0) {
      out[itemId] = count;
    }
  }
  return out;
}

function copyFiniteStats(
  stats: Readonly<Record<string, number>>,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [statId, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    out[statId] = value;
  }
  return out;
}

/**
 * Build a snapshot from live runtime fields. Returns `undefined` when the
 * host cannot form a valid save (e.g. unknown facing, non-integer tile).
 */
export function captureGameSaveSnapshot(input: GameSaveCaptureInput): GameSaveSnapshot | undefined {
  if (input.mapFile.length === 0) return undefined;
  if (!Number.isInteger(input.x) || !Number.isInteger(input.y)) return undefined;
  if (!Number.isInteger(input.floor) || input.floor < 0) return undefined;
  if (!FACINGS.has(input.facing)) return undefined;

  const inventory = copyPositiveInventory(input.inventory);
  if (inventory === undefined) return undefined;
  const stats = copyFiniteStats(input.stats);
  if (stats === undefined) return undefined;

  return {
    mapFile: input.mapFile.replaceAll('\\', '/'),
    x: input.x,
    y: input.y,
    floor: input.floor,
    facing: input.facing,
    world: { ...input.world },
    inventory,
    stats,
  };
}
