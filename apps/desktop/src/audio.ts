/**
 * Audio playback for the runtime, exposed to authored content as the first
 * consumer of core's {@link CommandPlugin} extension point rather than as new
 * builtin commands — playing a sound is genre-agnostic, but it is still a
 * verb the engine does not need to know about at its core.
 *
 * Web Audio rather than `HTMLAudioElement`: SFX overlap (two hits of the same
 * clip in the same frame must both be heard, which one media element cannot
 * do), and BGM needs a gain ramp for fades.
 *
 * The player itself is a thin IO wrapper over `AudioContext` and is left
 * untested per this repo's convention (see `catalog-client.ts`'s note on the
 * pure/imperative split); the pure path and option validation below are unit
 * tested in `test/audio.test.ts`.
 */

import type { CommandPlugin } from '@threemaker/core';

/** Resolves a manifest-relative audio path to its raw encoded bytes. */
export interface AudioSource {
  load(path: string): Promise<ArrayBuffer>;
}

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
const DEFAULT_BGM_FADE_MS = 400;

/**
 * Decodes on first use and caches by path. One `AudioContext`, two gain
 * buses (sfx / bgm) under a master gain, so a settings screen can move any of
 * the three independently.
 */
export class AudioPlayer {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly sfxBus: GainNode;
  private readonly bgmBus: GainNode;
  private readonly source: AudioSource;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();

  /** Source + its own gain, kept together so a stop can ramp the gain down before stopping the source. */
  private bgmNode: { readonly source: AudioBufferSourceNode; readonly gain: GainNode } | null =
    null;
  private bgmPath: string | null = null;
  /** Monotonic token so a slow decode from a superseded `playBgm` cannot start after a newer one. */
  private bgmGeneration = 0;

  constructor(opts: { source: AudioSource; context?: AudioContext }) {
    this.source = opts.source;
    this.context = opts.context ?? new AudioContext();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.sfxBus = this.context.createGain();
    this.sfxBus.connect(this.master);
    this.bgmBus = this.context.createGain();
    this.bgmBus.connect(this.master);
  }

  /**
   * Browsers start an `AudioContext` suspended until a user gesture. Call
   * this from the first input event; it is a no-op afterwards.
   */
  async unlock(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setMasterVolume(volume: number): void {
    this.master.gain.value = volume;
  }

  setSfxVolume(volume: number): void {
    this.sfxBus.gain.value = volume;
  }

  setBgmVolume(volume: number): void {
    this.bgmBus.gain.value = volume;
  }

  private buffer(path: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(path);
    if (pending === undefined) {
      pending = this.source
        .load(path)
        .then((bytes) => this.context.decodeAudioData(bytes))
        .catch((error: unknown) => {
          // Drop the rejected promise so a transient read failure does not
          // poison the cache for the rest of the session.
          this.buffers.delete(path);
          throw error;
        });
      this.buffers.set(path, pending);
    }
    return pending;
  }

  /** Fire-and-forget one-shot. A failed load is logged, never thrown at the script. */
  playSound(path: string, volume = DEFAULT_VOLUME): void {
    void this.buffer(path)
      .then((buffer) => {
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        const gain = this.context.createGain();
        gain.gain.value = volume;
        node.connect(gain);
        gain.connect(this.sfxBus);
        node.start();
        node.addEventListener('ended', () => {
          node.disconnect();
          gain.disconnect();
        });
      })
      .catch((error: unknown) => {
        console.error(`AudioPlayer: could not play sound ${JSON.stringify(path)}`, error);
      });
  }

  /** Swap the looping background track. Re-requesting the track already playing is a no-op. */
  playBgm(path: string, opts: { volume?: number; fadeMs?: number; loop?: boolean } = {}): void {
    if (this.bgmPath === path) return;
    this.bgmGeneration += 1;
    const generation = this.bgmGeneration;
    const fadeMs = opts.fadeMs ?? DEFAULT_BGM_FADE_MS;
    this.bgmPath = path;
    this.stopCurrentBgm(fadeMs);

    void this.buffer(path)
      .then((buffer) => {
        // A newer playBgm/stopBgm landed while this decoded — drop this one.
        if (generation !== this.bgmGeneration) return;
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        node.loop = opts.loop ?? true;
        const gain = this.context.createGain();
        const target = opts.volume ?? DEFAULT_VOLUME;
        const now = this.context.currentTime;
        gain.gain.setValueAtTime(fadeMs > 0 ? 0 : target, now);
        if (fadeMs > 0) gain.gain.linearRampToValueAtTime(target, now + fadeMs / 1000);
        node.connect(gain);
        gain.connect(this.bgmBus);
        node.start();
        this.bgmNode = { source: node, gain };
      })
      .catch((error: unknown) => {
        if (generation === this.bgmGeneration) this.bgmPath = null;
        console.error(`AudioPlayer: could not play bgm ${JSON.stringify(path)}`, error);
      });
  }

  stopBgm(fadeMs = DEFAULT_BGM_FADE_MS): void {
    this.bgmGeneration += 1;
    this.bgmPath = null;
    this.stopCurrentBgm(fadeMs);
  }

  private stopCurrentBgm(fadeMs: number): void {
    const playing = this.bgmNode;
    if (playing === null) return;
    this.bgmNode = null;
    const { source, gain } = playing;
    const now = this.context.currentTime;
    const seconds = Math.max(0, fadeMs) / 1000;
    if (seconds > 0) {
      // Pin the current value first: without setValueAtTime the ramp starts
      // from the last *scheduled* value, which mid-fade-in is not what is
      // actually audible.
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + seconds);
    }
    try {
      source.stop(now + seconds);
    } catch {
      // Already stopped: nothing to unwind.
    }
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
    });
  }

  dispose(): void {
    this.stopBgm(0);
    this.buffers.clear();
    void this.context.close();
  }
}

/**
 * The audio verbs as plugins: `playSound`, `playBgm`, `stopBgm`. All three
 * return `'continue'` — audio never blocks a script, so a sound effect mid
 * dialogue does not stall the scene waiting for the clip to finish.
 *
 * Register them on the same {@link CommandRegistry} handed to
 * `parseMapDocument` and to the `EventInterpreter`.
 */
export function createAudioCommands(player: AudioPlayer): readonly CommandPlugin[] {
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
        player.playSound(command.path as string, (command.volume as number) ?? DEFAULT_VOLUME);
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
        // `undefined` is not the same as an absent key, and the player's
        // defaults only apply to absent ones.
        player.playBgm(command.path as string, {
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
        player.stopBgm(command.fadeMs as number | undefined);
        return 'continue';
      },
    },
  ];
}
