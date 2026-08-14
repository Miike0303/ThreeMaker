/**
 * C8 WU-01: pure session-weather helpers (parse, dim factor, ambient composition).
 * Desktop narrative-root composition lives in
 * `apps/desktop/test/session-weather-composition.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  composeAmbientIntensity,
  parseWeatherMode,
  weatherDimFactor,
} from '../src/runtime/session-weather.js';
import { baseSceneLightSetup, dayNightAmbientFactor } from '../src/runtime/sheet-tile-lighting.js';

describe('parseWeatherMode', () => {
  it('accepts the four weather literals', () => {
    expect(parseWeatherMode('clear')).toBe('clear');
    expect(parseWeatherMode('rain')).toBe('rain');
    expect(parseWeatherMode('snow')).toBe('snow');
    expect(parseWeatherMode('fog')).toBe('fog');
  });

  it("falls back to 'clear' for unknown strings, wrong types, and absent values", () => {
    // Lazy-safe: authored typos and bad save data degrade to clear, never crash.
    expect(parseWeatherMode('storm')).toBe('clear');
    expect(parseWeatherMode(42)).toBe('clear');
    expect(parseWeatherMode(undefined)).toBe('clear');
    expect(parseWeatherMode(null)).toBe('clear');
    expect(parseWeatherMode(true)).toBe('clear');
    expect(parseWeatherMode({})).toBe('clear');
    expect(parseWeatherMode('Clear')).toBe('clear'); // case-sensitive
  });
});

describe('weatherDimFactor', () => {
  it('returns the documented dim factors per mode', () => {
    expect(weatherDimFactor('clear')).toBe(1.0);
    expect(weatherDimFactor('rain')).toBe(0.8);
    expect(weatherDimFactor('snow')).toBe(0.9);
    expect(weatherDimFactor('fog')).toBe(0.85);
  });
});

describe('composeAmbientIntensity (dayNight × weather × base)', () => {
  it('matches rain-at-night vs clear-at-noon numerically', () => {
    const litBase = baseSceneLightSetup(true).ambient.intensity; // Math.PI
    const noon = 720; // 12:00 day plateau → dayNight 1.0
    const night = 1350; // 22:30 night plateau → dayNight 0.35

    expect(dayNightAmbientFactor(noon)).toBeCloseTo(1.0);
    expect(dayNightAmbientFactor(night)).toBeCloseTo(0.35);

    const clearNoon = composeAmbientIntensity(
      litBase,
      dayNightAmbientFactor(noon),
      weatherDimFactor('clear'),
    );
    const rainNight = composeAmbientIntensity(
      litBase,
      dayNightAmbientFactor(night),
      weatherDimFactor('rain'),
    );

    expect(clearNoon).toBeCloseTo(Math.PI * 1.0 * 1.0);
    expect(rainNight).toBeCloseTo(Math.PI * 0.35 * 0.8);
    expect(rainNight).toBeLessThan(clearNoon);
  });
});
