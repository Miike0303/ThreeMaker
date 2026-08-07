/**
 * C8 WU-01: pure session-weather helpers (parse, dim factor, ambient composition)
 * + world-state seeding / signal / setWorldVar seams (headless).
 */
import { type EventHost, EventInterpreter, WorldClock, WorldState } from '@threemaker/core';
import { describe, expect, it, vi } from 'vitest';
import { createNarrativeRoot } from '../src/narrative-root.js';
import {
  composeAmbientIntensity,
  parseWeatherMode,
  WEATHER_KEY,
  type WeatherMode,
  weatherDimFactor,
} from '../src/session-weather.js';
import { baseSceneLightSetup, dayNightAmbientFactor } from '../src/sheet-tile-lighting.js';

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

describe('root seeding (weather.current)', () => {
  function makeRoot() {
    return createNarrativeRoot({
      createOverlay: () => {
        throw new Error('headless tests must not build the session overlay');
      },
      clock: new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 }),
    });
  }

  it('seeds weather.current to clear on a fresh root', () => {
    const root = makeRoot();
    expect(root.world.get(WEATHER_KEY)).toBe('clear');
  });

  it('does not let a map worldSeed override weather.current (seedIfAbsent skip)', () => {
    const root = makeRoot();
    // Per-map worldSeeds for weather are inert: maps set weather via enter-trigger
    // setWorldVar instead. seedIfAbsent skips the already-present root key.
    root.seedIfAbsent({ [WEATHER_KEY]: 'rain' });
    expect(root.world.get(WEATHER_KEY)).toBe('clear');
  });
});

describe('subscription-driven weather signal (WorldState seam)', () => {
  it('world.set(WEATHER_KEY, rain) emits changed with the right key/value', () => {
    const world = new WorldState();
    world.set(WEATHER_KEY, 'clear');
    const changed = vi.fn();
    world.signals.on('changed', changed);

    world.set(WEATHER_KEY, 'rain');

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({
      key: WEATHER_KEY,
      value: 'rain',
      previous: 'clear',
    });
    expect(parseWeatherMode(world.get(WEATHER_KEY))).toBe('rain');
  });
});

describe('setWorldVar weather.current via EventInterpreter', () => {
  const HOST: EventHost = {
    moveEntity: (_entityId, _direction, _steps, done) => done(),
    teleport: () => {
      /* unused */
    },
    transferMap: (_mapFile, _x, _y, _facing, done) => done(),
  };

  it("runs setWorldVar weather.current = 'rain' over the root world and emits", () => {
    const root = createNarrativeRoot({
      createOverlay: () => {
        throw new Error('headless tests must not build the session overlay');
      },
      clock: new WorldClock({ minutesPerRealSecond: 1, startMinutes: 480 }),
    });
    expect(root.world.get(WEATHER_KEY)).toBe('clear');

    const changed = vi.fn();
    root.world.signals.on('changed', changed);

    const interpreter = new EventInterpreter({ world: root.world, host: HOST });
    interpreter.run([{ type: 'setWorldVar', key: WEATHER_KEY, value: 'rain' }]);

    expect(root.world.get(WEATHER_KEY)).toBe('rain');
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ key: WEATHER_KEY, value: 'rain', previous: 'clear' }),
    );
    // Pure step main.ts would apply on the signal:
    const mode: WeatherMode = parseWeatherMode(root.world.get(WEATHER_KEY));
    expect(mode).toBe('rain');
    expect(weatherDimFactor(mode)).toBe(0.8);
  });
});
