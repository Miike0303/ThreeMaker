/**
 * Pure seed / density helpers for Maker Studio procgen UI.
 */
import { clampRange } from '../clamp.js';

/** Default sparse furniture density (matches stampSimpleDungeon default). */
export const DEFAULT_FURNITURE_DENSITY = 0.06;

/** Max recent Generate seeds kept for one-click replay (newest first). */
export const PROCGEN_SEED_HISTORY_MAX = 8;

/**
 * Advance seed after a successful Generate so the next click yields a new layout.
 * Wraps uint32.
 */
export function nextProcgenSeed(current: number): number {
  return ((current >>> 0) + 1) >>> 0;
}

/** Random 0..999_999_999 seed (uint32-safe). */
export function randomProcgenSeed(rng: () => number = Math.random): number {
  const r = rng();
  if (!Number.isFinite(r)) return 0;
  return (Math.abs(r) * 1_000_000_000) >>> 0;
}

/** Clamp furniture density to [0, 1]; non-finite → fallback (then default). */
export function clampFurnitureDensity(
  value: number,
  fallback: number = DEFAULT_FURNITURE_DENSITY,
): number {
  if (!Number.isFinite(value)) {
    if (!Number.isFinite(fallback)) return DEFAULT_FURNITURE_DENSITY;
    return clampRange(fallback, 0, 1);
  }
  return clampRange(value, 0, 1);
}

/** UI percent (0–100) → density 0–1. */
export function furnitureDensityFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_FURNITURE_DENSITY;
  return clampFurnitureDensity(percent / 100, 0);
}

/** Density 0–1 → rounded UI percent 0–100. */
export function furnitureDensityToPercent(density: number): number {
  return Math.round(clampFurnitureDensity(density) * 100);
}

/**
 * Prepend a used Generate seed to history (newest first).
 * Dedupes exact seed (moves to front), coerces uint32, caps at max.
 */
export function pushProcgenSeedHistory(
  history: readonly number[],
  seed: number,
  max: number = PROCGEN_SEED_HISTORY_MAX,
): readonly number[] {
  const s = seed >>> 0;
  const cap = Math.max(1, Math.floor(max));
  const rest = history.filter((h) => h >>> 0 !== s).map((h) => h >>> 0);
  return [s, ...rest].slice(0, cap);
}
