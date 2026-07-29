/**
 * The SESSION-scoped half of the desktop narrative runtime (C1a spec R6).
 *
 * Created ONCE per session and deliberately NOT rebuilt on a map swap:
 * `WorldState` holds authored world data whose whole point is to outlive the
 * map that set it, the seed set must be applied once per session rather than
 * once per map, and the dialogue overlay is a single piece of session chrome.
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

import { WorldState, type WorldValue } from '@threemaker/core';
import type { DialogueOverlay } from './dialogue-ui.js';

export interface NarrativeRootDeps {
  /**
   * Builds the session's dialogue overlay, including mounting its element.
   * Called at most once, on the first `overlay()` call.
   */
  readonly createOverlay: () => DialogueOverlay;
}

export interface NarrativeRoot {
  /** Session-scoped world data. Survives every map swap; never replaced. */
  readonly world: WorldState;
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
  let overlay: DialogueOverlay | undefined;

  return {
    world,

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
