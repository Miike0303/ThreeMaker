/**
 * Pure session-weather helpers (C8 WU-01). Kept free of DOM / three so vitest
 * can drive them under `environment: 'node'`.
 *
 * Weather is world-state (`weather.current`); authored events use `setWorldVar`
 * and Ink uses `world_set` — no dedicated weather command. Particle/fog
 * visuals land in WU-02 via the `weatherVisualHook` seam in main.ts.
 */

/** World-state key for the current weather mode (string type-lock). */
export const WEATHER_KEY = 'weather.current';

export type WeatherMode = 'clear' | 'rain' | 'snow' | 'fog';

const WEATHER_MODES: readonly WeatherMode[] = ['clear', 'rain', 'snow', 'fog'];

/** clear: full brightness. */
const DIM_CLEAR = 1.0;
/** rain: modest overcast dim. */
const DIM_RAIN = 0.8;
/** snow: light overcast. */
const DIM_SNOW = 0.9;
/** fog: soft veil dim. */
const DIM_FOG = 0.85;

/**
 * Parse a world-state / save / script value into a {@link WeatherMode}.
 * The four literals pass; ANYTHING else (wrong type, unknown string, undefined)
 * returns `'clear'` — lazy-safe fallback so authored typos degrade to clear
 * weather and never crash the session.
 */
export function parseWeatherMode(value: unknown): WeatherMode {
  if (typeof value === 'string' && (WEATHER_MODES as readonly string[]).includes(value)) {
    return value as WeatherMode;
  }
  return 'clear';
}

/** Ambient/directional intensity scale for the given weather mode. */
export function weatherDimFactor(mode: WeatherMode): number {
  switch (mode) {
    case 'clear':
      return DIM_CLEAR;
    case 'rain':
      return DIM_RAIN;
    case 'snow':
      return DIM_SNOW;
    case 'fog':
      return DIM_FOG;
  }
}

/**
 * Pure ambient intensity composition used by `applyDayNightAmbient`:
 * `base * dayNightFactor * weatherDimFactor`. Exported so headless tests can
 * assert rain-at-night vs clear-at-noon without three.js lights.
 */
export function composeAmbientIntensity(
  baseIntensity: number,
  dayNightFactor: number,
  weatherFactor: number,
): number {
  return baseIntensity * dayNightFactor * weatherFactor;
}
