/**
 * Pure capture of runtime progress into a {@link GameSaveSnapshot} (C3 WU-02).
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
};

const FACINGS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right']);

/**
 * Build a snapshot from live runtime fields. Returns `undefined` when the
 * host cannot form a valid save (e.g. unknown facing, non-integer tile).
 */
export function captureGameSaveSnapshot(input: GameSaveCaptureInput): GameSaveSnapshot | undefined {
  if (input.mapFile.length === 0) return undefined;
  if (!Number.isInteger(input.x) || !Number.isInteger(input.y)) return undefined;
  if (!Number.isInteger(input.floor) || input.floor < 0) return undefined;
  if (!FACINGS.has(input.facing)) return undefined;

  return {
    mapFile: input.mapFile.replaceAll('\\', '/'),
    x: input.x,
    y: input.y,
    floor: input.floor,
    facing: input.facing,
    world: { ...input.world },
  };
}
