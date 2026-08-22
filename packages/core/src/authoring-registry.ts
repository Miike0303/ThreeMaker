/**
 * Parse-only {@link CommandRegistry} shared by editor load/validate and MCP.
 *
 * Audio verbs are accepted with the same path/volume/fade rules as desktop,
 * but `run` is a no-op (no playback while authoring). Register new
 * authoring plugins here so `parseMapDocument` / `parseEventScript` cannot
 * drift between surfaces. Desktop runtime builds its own registry with
 * live {@link createAudioCommandPlugins} handlers — do not use this one
 * for playback.
 */

import { createAudioCommandPlugins } from './audio-commands.js';
import { CommandRegistry } from './plugin.js';

let cached: CommandRegistry | undefined;

/** Fresh parse-only registry with the current authoring plugin set. */
export function createAuthoringCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const plugin of createAudioCommandPlugins()) {
    registry.register(plugin);
  }
  return registry;
}

/** Singleton authoring registry. Safe to call repeatedly. */
export function authoringPlugins(): CommandRegistry {
  cached ??= createAuthoringCommandRegistry();
  return cached;
}
