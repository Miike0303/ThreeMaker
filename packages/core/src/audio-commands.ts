/**
 * Shared audio command plugins (`playSound`, `playBgm`, `stopBgm`).
 *
 * Parse rules live here so desktop runtime, editor authoring, and MCP all
 * accept the same authored shape. Runtime playback is optional: without
 * handlers, `run` is a no-op that returns `'continue'` (editor/MCP validate-
 * only registries). Desktop injects an {@link AudioCommandHandlers} that
 * forwards to its Web Audio player.
 */

import type { CommandPlugin } from './plugin.js';

/**
 * Validates an authored audio path with the same rules as core's
 * `transferMap` `mapFile`: manifest-relative, no `..` escape, no absolute
 * path. Authored content is untrusted input at this boundary — a map can be
 * shared, and a path that walks out of the asset directory would let it read
 * arbitrary host files.
 */
export function parseAudioPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} requires a non-empty string "path".`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) {
    throw new Error(
      `${label} "path" must not contain ".." segments, got ${JSON.stringify(value)}.`,
    );
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(
      `${label} "path" must be a manifest-relative path, not absolute, got ${JSON.stringify(value)}.`,
    );
  }
  return normalized;
}

/** Validates an optional 0..1 gain. Out-of-range is a content bug, not something to silently clamp. */
export function parseVolume(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `${label} "volume" must be a number between 0 and 1, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** Validates an optional fade duration in milliseconds. */
export function parseFadeMs(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${label} "fadeMs" must be a non-negative number, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

const DEFAULT_VOLUME = 1;

/**
 * Optional runtime side of the audio verbs. Omit any method (or pass `{}`) for
 * a parse-only registry: `run` still returns `'continue'` and never blocks.
 */
export interface AudioCommandHandlers {
  playSound?(path: string, volume: number): void;
  playBgm?(path: string, opts: { volume?: number; fadeMs?: number; loop?: boolean }): void;
  stopBgm?(fadeMs?: number): void;
}

/**
 * The audio verbs as plugins: `playSound`, `playBgm`, `stopBgm`. All three
 * return `'continue'` — audio never blocks a script, so a sound effect mid
 * dialogue does not stall the scene waiting for the clip to finish.
 *
 * Register them on the same {@link CommandRegistry} handed to
 * `parseMapDocument` / `parseEventScript` and to the `EventInterpreter`.
 */
export function createAudioCommandPlugins(
  handlers: AudioCommandHandlers = {},
): readonly CommandPlugin[] {
  return [
    {
      type: 'playSound',
      parse(value, path) {
        return {
          type: 'playSound',
          path: parseAudioPath(value.path, path),
          ...(parseVolume(value.volume, path) !== undefined ? { volume: value.volume } : {}),
        };
      },
      run(command) {
        handlers.playSound?.(command.path as string, (command.volume as number) ?? DEFAULT_VOLUME);
        return 'continue';
      },
    },
    {
      type: 'playBgm',
      parse(value, path) {
        const volume = parseVolume(value.volume, path);
        const fadeMs = parseFadeMs(value.fadeMs, path);
        if (value.loop !== undefined && typeof value.loop !== 'boolean') {
          throw new Error(`${path} "loop" must be a boolean when present.`);
        }
        return {
          type: 'playBgm',
          path: parseAudioPath(value.path, path),
          ...(volume !== undefined ? { volume } : {}),
          ...(fadeMs !== undefined ? { fadeMs } : {}),
          ...(value.loop !== undefined ? { loop: value.loop } : {}),
        };
      },
      run(command) {
        // Built key-by-key: under `exactOptionalPropertyTypes` an explicit
        // `undefined` is not the same as an absent key, and player defaults
        // only apply to absent ones.
        handlers.playBgm?.(command.path as string, {
          ...(command.volume !== undefined ? { volume: command.volume as number } : {}),
          ...(command.fadeMs !== undefined ? { fadeMs: command.fadeMs as number } : {}),
          ...(command.loop !== undefined ? { loop: command.loop as boolean } : {}),
        });
        return 'continue';
      },
    },
    {
      type: 'stopBgm',
      parse(value, path) {
        const fadeMs = parseFadeMs(value.fadeMs, path);
        return { type: 'stopBgm', ...(fadeMs !== undefined ? { fadeMs } : {}) };
      },
      run(command) {
        handlers.stopBgm?.(command.fadeMs as number | undefined);
        return 'continue';
      },
    },
  ];
}
