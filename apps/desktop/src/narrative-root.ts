/**
 * The SESSION-scoped half of the desktop narrative runtime (C1a spec R6).
 *
 * Created ONCE per session and deliberately NOT rebuilt on a map swap:
 * `WorldState` holds authored world data whose whole point is to outlive the
 * map that set it, the seed set must be applied once per session rather than
 * once per map, and the dialogue overlay is a single piece of session chrome.
 * Session inventory and stats (C4) live here for the same reason: map hops
 * tear down the per-map narrative bundle, but inventory/stats must survive.
 *
 * Everything narrative that is per-map -- compiled Ink stories, the dialogue
 * provider, the `EventInterpreter`, NPCs, triggers and NPC sprites -- lives in
 * the per-map bundle instead and IS rebuilt on swap. A story compiled for map
 * A has no meaning on map B, and `EventInterpreter` takes its provider at
 * construction, so those cannot be hoisted here (spec R6's rationale).
 *
 * The overlay is INJECTED as a factory rather than built here so this module
 * stays DOM-free: `createDialogueOverlay` needs `document`, and this repo's
 * vitest runs under `environment: 'node'`. The caller therefore also owns
 * where the element is mounted; the root owns only its LIFETIME -- built on
 * first request, then the same instance for the rest of the session.
 */

import { type WorldClock, WorldState, type WorldValue } from '@threemaker/core';
import { Inventory, StatBlock } from '@threemaker/gameplay';
import type { DialogueOverlay } from './dialogue-ui.js';
import { CLOCK_MINUTES_KEY } from './session-clock.js';
import { WEATHER_KEY } from './session-weather.js';

export interface NarrativeRootDeps {
  /**
   * Builds the session's dialogue overlay, including mounting its element.
   * Called at most once, on the first `overlay()` call.
   */
  readonly createOverlay: () => DialogueOverlay;
  /**
   * Session inventory. Defaults to a fresh empty {@link Inventory}. Built
   * once by the host (always empty at session start until giveItem runs).
   */
  readonly inventory?: Inventory;
  /**
   * Session stats. Defaults to an empty {@link StatBlock} (zero stats).
   * When the host loads game-defs, it constructs the block from those stats
   * and injects it here so map hops never rebuild it.
   */
  readonly stats?: StatBlock;
  /**
   * Session world clock (C7). Constructed by the host with the desired
   * `minutesPerRealSecond`; lives here so it survives map hops. Seeded into
   * world-state at root creation (see {@link createNarrativeRoot}).
   */
  readonly clock: WorldClock;
}

export interface NarrativeRoot {
  /** Session-scoped world data. Survives every map swap; never replaced. */
  readonly world: WorldState;
  /** Session inventory. Survives every map swap; never replaced. */
  readonly inventory: Inventory;
  /** Session stats. Survives every map swap; never replaced. */
  readonly stats: StatBlock;
  /**
   * Session world clock. Survives every map swap; never replaced. Advances
   * from main.ts's game loop; `clock.minutes` is mirrored into world-state
   * once per crossed simulated minute.
   */
  readonly clock: WorldClock;
  /**
   * Applies an authored map's `worldSeeds`, skipping every key the world
   * already holds. Idempotent per key, so loading a second map (or re-entering
   * the first) cannot reset a value a story changed.
   */
  seedIfAbsent(seeds: Readonly<Record<string, WorldValue>>): void;
  /** The session's single dialogue overlay, built on first call. */
  overlay(): DialogueOverlay;
}

export function createNarrativeRoot(deps: NarrativeRootDeps): NarrativeRoot {
  const world = new WorldState();
  const inventory = deps.inventory ?? new Inventory();
  const stats = deps.stats ?? new StatBlock([]);
  const clock = deps.clock;
  let overlay: DialogueOverlay | undefined;

  // Seed clock.minutes BEFORE any map bundle/story exists so ink
  // world_get("clock.minutes") binds and the numeric type-lock is set.
  // A map's worldSeeds declaring clock.minutes as a string must lose: root
  // seeds first, and seedIfAbsent skips already-present keys — which does
  // the right thing automatically.
  world.set(CLOCK_MINUTES_KEY, clock.minutes);

  // Seed weather.current as a string type-lock BEFORE any map bundle/story.
  // Default is clear. Per-map worldSeeds for weather.current are inert:
  // seedIfAbsent skips this already-present key — maps set initial weather
  // via an enter-trigger event `setWorldVar` instead (not worldSeeds).
  world.set(WEATHER_KEY, 'clear');

  return {
    world,
    inventory,
    stats,
    clock,

    seedIfAbsent(seeds) {
      for (const [key, value] of Object.entries(seeds)) {
        // Guarded per key by `has`, not by "have we seeded before": a key can
        // already carry a story-set value before this map's seeds arrive.
        // Skipping also means no `changed` signal fires for a no-op seed, and
        // it sidesteps `WorldState.set`'s type lock -- re-seeding a key whose
        // stored type drifted would otherwise throw mid-load.
        if (!world.has(key)) world.set(key, value);
      }
    },

    overlay() {
      overlay ??= deps.createOverlay();
      return overlay;
    },
  };
}
