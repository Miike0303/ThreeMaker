import { CommandRegistry, parseEventScript } from '@threemaker/core';
import { describe, expect, it, vi } from 'vitest';
import {
  type AudioPlayer,
  createAudioCommands,
  parseAudioPath,
  parseFadeMs,
  parseVolume,
} from '../src/audio.js';

/** The plugins only ever call these three; the rest of `AudioPlayer` is Web Audio IO. */
function fakePlayer() {
  return {
    playSound: vi.fn(),
    playBgm: vi.fn(),
    stopBgm: vi.fn(),
  } as unknown as AudioPlayer & {
    playSound: ReturnType<typeof vi.fn>;
    playBgm: ReturnType<typeof vi.fn>;
    stopBgm: ReturnType<typeof vi.fn>;
  };
}

function registryFor(player: AudioPlayer): CommandRegistry {
  const registry = new CommandRegistry();
  for (const plugin of createAudioCommands(player)) registry.register(plugin);
  return registry;
}

const script = (command: unknown) => ({ version: 1, events: { intro: [command] } });

describe('parseAudioPath', () => {
  it('accepts a manifest-relative path', () => {
    expect(parseAudioPath('bgm/town.ogg', 'x')).toBe('bgm/town.ogg');
  });

  it('normalizes backslashes', () => {
    expect(parseAudioPath('bgm\\town.ogg', 'x')).toBe('bgm/town.ogg');
  });

  it('rejects a parent-directory escape', () => {
    expect(() => parseAudioPath('../../secrets.ogg', 'x')).toThrow(/".." segments/);
  });

  it('rejects a parent-directory escape written with backslashes', () => {
    expect(() => parseAudioPath('bgm\\..\\..\\secrets.ogg', 'x')).toThrow(/".." segments/);
  });

  it('rejects a POSIX absolute path', () => {
    expect(() => parseAudioPath('/etc/passwd', 'x')).toThrow(/not absolute/);
  });

  it('rejects a Windows absolute path', () => {
    expect(() => parseAudioPath('C:\\Windows\\win.ini', 'x')).toThrow(/not absolute/);
  });

  it('rejects an empty path', () => {
    expect(() => parseAudioPath('', 'x')).toThrow(/non-empty string/);
  });
});

describe('parseVolume / parseFadeMs', () => {
  it('allows an absent volume', () => {
    expect(parseVolume(undefined, 'x')).toBeUndefined();
  });

  it.each([-0.1, 1.1, Number.NaN, '0.5'])('rejects volume %p', (value) => {
    expect(() => parseVolume(value, 'x')).toThrow(/between 0 and 1/);
  });

  it('rejects a negative fade', () => {
    expect(() => parseFadeMs(-1, 'x')).toThrow(/non-negative/);
  });
});

describe('audio command plugins', () => {
  it('parses and runs playSound', () => {
    const player = fakePlayer();
    const registry = registryFor(player);
    const parsed = parseEventScript(
      script({ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }),
      registry,
    );
    expect(parsed.intro).toEqual([{ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }]);

    const plugin = registry.get('playSound');
    expect(plugin?.run({ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }, {} as never)).toBe(
      'continue',
    );
    expect(player.playSound).toHaveBeenCalledWith('se/hit.ogg', 0.5);
  });

  it('defaults playSound volume when omitted', () => {
    const player = fakePlayer();
    const registry = registryFor(player);
    registry.get('playSound')?.run({ type: 'playSound', path: 'se/hit.ogg' }, {} as never);
    expect(player.playSound).toHaveBeenCalledWith('se/hit.ogg', 1);
  });

  it('parses playBgm with loop and fade', () => {
    const registry = registryFor(fakePlayer());
    const parsed = parseEventScript(
      script({ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 800, loop: false }),
      registry,
    );
    expect(parsed.intro).toEqual([
      { type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 800, loop: false },
    ]);
  });

  it('rejects a non-boolean loop', () => {
    const registry = registryFor(fakePlayer());
    expect(() =>
      parseEventScript(script({ type: 'playBgm', path: 'bgm/town.ogg', loop: 'yes' }), registry),
    ).toThrow(/"loop" must be a boolean/);
  });

  it('parses stopBgm with no options', () => {
    const registry = registryFor(fakePlayer());
    const parsed = parseEventScript(script({ type: 'stopBgm' }), registry);
    expect(parsed.intro).toEqual([{ type: 'stopBgm' }]);
  });

  it('rejects an escaping path through the full parse path', () => {
    const registry = registryFor(fakePlayer());
    expect(() =>
      parseEventScript(script({ type: 'playSound', path: '../../etc/passwd' }), registry),
    ).toThrow(/".." segments/);
  });

  it('registers all three verbs without colliding', () => {
    expect(registryFor(fakePlayer()).types()).toEqual(['playSound', 'playBgm', 'stopBgm']);
  });
});
