/**
 * C8 WU-01: session-weather composition with desktop narrative root (headless).
 */
import { type EventHost, EventInterpreter, WorldClock, WorldState } from '@threemaker/core';
import {
  parseWeatherMode,
  WEATHER_KEY,
  type WeatherMode,
  weatherDimFactor,
} from '@threemaker/renderer';
import { describe, expect, it, vi } from 'vitest';
import { createNarrativeRoot } from '../src/narrative-root.js';

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
