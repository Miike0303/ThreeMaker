import type { WorldState, WorldValue } from '@threemaker/core';
import type { Story } from 'inkjs';

function isWorldValue(value: unknown): value is WorldValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

/** Options for {@link bindStoryToWorld}. */
export type BindStoryToWorldOptions = {
  /** Identifies this story instance for the observer mirror key namespace (`ink.{storyId}.{var}`). */
  readonly storyId: string;
  /** The shared world-state this story's externals read from and write to. */
  readonly world: WorldState;
  /**
   * Names of ink global `VAR`s to mirror one-way into world-state whenever
   * the story changes them, under key `ink.{storyId}.{name}`. Each name
   * must be declared as a global variable in the ink source, or inkjs's
   * `ObserveVariable` throws. Omit for stories that only use the
   * `world_get`/`world_set` externals.
   */
  readonly observedVariables?: readonly string[];
};

/**
 * Binds `story`'s `world_get`/`world_set` external functions to `world`, and
 * optionally mirrors declared ink variables into world-state as they change.
 *
 * `story`'s ink source must declare both externals:
 * ```
 * EXTERNAL world_get(key)
 * EXTERNAL world_set(key, value)
 * ```
 * `world_get` reads `world.get(key)` (returns `undefined`/ink `null` for an
 * unset key); `world_set` calls `world.set(key, value)`. Both directions are
 * externals-driven (ink pulls/pushes) — the optional observer mirror is a
 * SEPARATE, one-way channel (ink var change -> world-state key), never the
 * reverse, so there's no sync loop between the two mechanisms.
 *
 * Mirrored variable values must be a {@link WorldValue} (boolean, number, or
 * string); a variable that becomes a non-primitive ink value (e.g. a `LIST`)
 * throws, since `WorldState` cannot represent it — same "fail loudly on
 * content bugs" philosophy as `WorldState.set`'s type lock.
 */
export function bindStoryToWorld(story: Story, options: BindStoryToWorldOptions): void {
  const { storyId, world, observedVariables = [] } = options;

  story.BindExternalFunction('world_get', (key: string) => world.get(key));
  story.BindExternalFunction('world_set', (key: string, value: WorldValue) => {
    world.set(key, value);
  });

  for (const variableName of observedVariables) {
    story.ObserveVariable(variableName, (name: string, newValue: unknown) => {
      if (!isWorldValue(newValue)) {
        throw new Error(
          `story-runtime: observed ink variable "${name}" changed to a non-primitive value (${typeof newValue}); only boolean/number/string ink variables can mirror into world-state.`,
        );
      }
      world.set(`ink.${storyId}.${name}`, newValue);
    });
  }
}
