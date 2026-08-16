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
 * pure/imperative split); pure path/option validation and the shared plugin
 * factory live in `@threemaker/core` and are unit tested there and below.
 */

import {
  type CommandPlugin,
  createAudioCommandPlugins,
  parseAudioPath,
  parseFadeMs,
  parseVolume,
} from '@threemaker/core';

export { parseAudioPath, parseFadeMs, parseVolume };

/** Resolves a manifest-relative audio path to its raw encoded bytes. */
export interface AudioSource {
  load(path: string): Promise<ArrayBuffer>;
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
 * Desktop runtime wrapper: shared parse plugins from core, wired to a real
 * {@link AudioPlayer}. Register on the same {@link CommandRegistry} handed to
 * `parseMapDocument` and to the `EventInterpreter`.
 */
export function createAudioCommands(player: AudioPlayer): readonly CommandPlugin[] {
  return createAudioCommandPlugins({
    playSound: (path, volume) => player.playSound(path, volume),
    playBgm: (path, opts) => player.playBgm(path, opts),
    stopBgm: (fadeMs) => player.stopBgm(fadeMs),
  });
}
