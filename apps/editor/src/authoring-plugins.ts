/**
 * Shared {@link CommandRegistry} for editor load/validate paths.
 *
 * Mirrors desktop's plugin set for parse-only use: audio verbs are accepted
 * with the same path/volume/fade rules, but `run` is a no-op (the editor does
 * not play audio while painting). Keep this the single place new authoring
 * plugins are registered so `loadMapDocument` and `validateEventsDraft` stay
 * in lockstep.
 */

import { CommandRegistry, createAudioCommandPlugins } from '@threemaker/core';

let cached: CommandRegistry | undefined;

/** Singleton authoring registry (noop run handlers). Safe to call repeatedly. */
export function authoringPlugins(): CommandRegistry {
  if (cached === undefined) {
    cached = new CommandRegistry();
    for (const plugin of createAudioCommandPlugins()) {
      cached.register(plugin);
    }
  }
  return cached;
}
