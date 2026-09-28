import { describe, expect, it, vi } from 'vitest';
import {
  createAudioCommandPlugins,
  parseAudioPath,
  parseFadeMs,
  parseVolume,
} from '../src/audio-commands.js';
import { parseEventScript } from '../src/event-command.js';
import { CommandRegistry } from '../src/plugin.js';

function registryFor(handlers = {}) {
  const registry = new CommandRegistry();
  for (const plugin of createAudioCommandPlugins(handlers)) registry.register(plugin);
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

  it('rejects a lowercase Windows drive path', () => {
    expect(() => parseAudioPath('c:\\Windows\\win.ini', 'x')).toThrow(/not absolute/);
  });

  it('rejects a lowercase D drive path', () => {
    expect(() => parseAudioPath('d:\\Games\\music.ogg', 'x')).toThrow(/not absolute/);
  });

  it('rejects an empty path', () => {
    expect(() => parseAudioPath('', 'x')).toThrow(/non-empty string/);
  });
});

describe('parseVolume / parseFadeMs', () => {
  it('allows an absent volume', () => {
    expect(parseVolume(undefined, 'x')).toBeUndefined();
  });

  it('rejects null rather than treating it as an absent volume', () => {
    expect(() => parseVolume(null, 'x')).toThrow(/between 0 and 1/);
  });

  it('allows zero volume', () => {
    expect(parseVolume(0, 'x')).toBe(0);
  });

  it('allows full volume', () => {
    expect(parseVolume(1, 'x')).toBe(1);
  });

  it('rejects a volume just below zero', () => {
    expect(() => parseVolume(-0.01, 'x')).toThrow(/between 0 and 1/);
  });

  it('rejects a volume slightly below zero', () => {
    expect(() => parseVolume(-0.001, 'x')).toThrow(/between 0 and 1/);
  });

  it('rejects a volume just above full gain', () => {
    expect(() => parseVolume(1.02, 'x')).toThrow(/between 0 and 1/);
  });

  it('rejects a volume slightly above full gain', () => {
    expect(() => parseVolume(1.005, 'x')).toThrow(/between 0 and 1/);
  });

  it.each([-0.1, 1.1, Number.NaN, '0.5'])('rejects volume %p', (value) => {
    expect(() => parseVolume(value, 'x')).toThrow(/between 0 and 1/);
  });

  it('rejects null rather than treating it as an absent fade', () => {
    expect(() => parseFadeMs(null, 'x')).toThrow(/non-negative/);
  });

  it('rejects a negative fade', () => {
    expect(() => parseFadeMs(-1, 'x')).toThrow(/non-negative/);
  });

  it('rejects a fractional negative fade', () => {
    expect(() => parseFadeMs(-0.25, 'x')).toThrow(/non-negative/);
  });

  it('rejects a fade just below zero', () => {
    expect(() => parseFadeMs(-0.01, 'x')).toThrow(/non-negative/);
  });

  it('rejects a slightly negative fade duration', () => {
    expect(() => parseFadeMs(-0.001, 'x')).toThrow(/non-negative/);
  });

  it('rejects a tiny negative fade duration', () => {
    expect(() => parseFadeMs(-0.0001, 'x')).toThrow(/non-negative/);
  });

  it('rejects an infinite fade duration', () => {
    expect(() => parseFadeMs(Number.POSITIVE_INFINITY, 'x')).toThrow(/non-negative/);
  });

  it('accepts a zero-length fade', () => {
    expect(parseFadeMs(0, 'x')).toBe(0);
  });

  it('accepts a fractional fade duration', () => {
    expect(parseFadeMs(0.5, 'x')).toBe(0.5);
  });
});

describe('createAudioCommandPlugins', () => {
  it('rejects playSound without a registry', () => {
    expect(() => parseEventScript(script({ type: 'playSound', path: 'se/hit.ogg' }))).toThrow(
      /unknown command type "playSound"/,
    );
  });

  it('parses playSound with a noop registry', () => {
    const registry = registryFor();
    const parsed = parseEventScript(
      script({ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }),
      registry,
    );
    expect(parsed.intro).toEqual([{ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }]);
    expect(
      registry.get('playSound')?.run({ type: 'playSound', path: 'se/hit.ogg' }, {} as never),
    ).toBe('continue');
  });

  it('rejects a playSound volume above full gain through the command parser', () => {
    expect(() =>
      parseEventScript(
        script({ type: 'playSound', path: 'se/hit.ogg', volume: 1.5 }),
        registryFor(),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it('omits playSound volume when it is not authored', () => {
    const parsed = parseEventScript(
      script({ type: 'playSound', path: 'se/hit.ogg' }),
      registryFor(),
    );

    expect(parsed.intro).toStrictEqual([{ type: 'playSound', path: 'se/hit.ogg' }]);
  });

  it('preserves an authored zero playSound volume during parsing', () => {
    const parsed = parseEventScript(
      script({ type: 'playSound', path: 'se/hit.ogg', volume: 0 }),
      registryFor(),
    );

    expect(parsed.intro).toStrictEqual([{ type: 'playSound', path: 'se/hit.ogg', volume: 0 }]);
  });

  it('forwards playSound to a handler when provided', () => {
    const playSound = vi.fn();
    const registry = registryFor({ playSound });
    registry
      .get('playSound')
      ?.run({ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }, {} as never);
    expect(playSound).toHaveBeenCalledWith('se/hit.ogg', 0.5);
  });

  it('forwards a silent playSound volume to a handler', () => {
    const playSound = vi.fn();
    const registry = registryFor({ playSound });
    registry
      .get('playSound')
      ?.run({ type: 'playSound', path: 'se/hit.ogg', volume: 0 }, {} as never);
    expect(playSound).toHaveBeenCalledWith('se/hit.ogg', 0);
  });

  it('defaults playSound volume when omitted', () => {
    const playSound = vi.fn();
    const registry = registryFor({ playSound });
    registry.get('playSound')?.run({ type: 'playSound', path: 'se/hit.ogg' }, {} as never);
    expect(playSound).toHaveBeenCalledWith('se/hit.ogg', 1);
  });

  it('parses playBgm with loop and fade', () => {
    const registry = registryFor();
    const parsed = parseEventScript(
      script({ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 800, loop: false }),
      registry,
    );
    expect(parsed.intro).toEqual([
      { type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 800, loop: false },
    ]);
  });

  it('rejects an escaping playBgm path through the command parser', () => {
    expect(() =>
      parseEventScript(script({ type: 'playBgm', path: '../outside.ogg' }), registryFor()),
    ).toThrow(/"\.\." segments/);
  });

  it('rejects playBgm volume above full gain through the command parser', () => {
    expect(() =>
      parseEventScript(
        script({ type: 'playBgm', path: 'bgm/town.ogg', volume: 1.5 }),
        registryFor(),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it('preserves an authored true playBgm loop during parsing', () => {
    const parsed = parseEventScript(
      script({ type: 'playBgm', path: 'bgm/town.ogg', loop: true }),
      registryFor(),
    );

    expect(parsed.intro).toStrictEqual([{ type: 'playBgm', path: 'bgm/town.ogg', loop: true }]);
  });

  it('preserves an authored zero playBgm volume during parsing', () => {
    const parsed = parseEventScript(
      script({ type: 'playBgm', path: 'bgm/town.ogg', volume: 0 }),
      registryFor(),
    );

    expect(parsed.intro).toStrictEqual([{ type: 'playBgm', path: 'bgm/town.ogg', volume: 0 }]);
  });

  it('preserves an authored zero playBgm fade during parsing', () => {
    const parsed = parseEventScript(
      script({ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 0 }),
      registryFor(),
    );

    expect(parsed.intro).toStrictEqual([{ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 0 }]);
  });

  it('forwards playBgm fadeMs to a handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });
    registry
      .get('playBgm')
      ?.run({ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 800 }, {} as never);
    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { fadeMs: 800 });
  });

  it('forwards a zero fade to a playBgm handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });

    registry.get('playBgm')?.run({ type: 'playBgm', path: 'bgm/town.ogg', fadeMs: 0 }, {} as never);

    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { fadeMs: 0 });
  });

  it('continues the script after playBgm without a playback handler', () => {
    const registry = registryFor();

    expect(
      registry.get('playBgm')?.run({ type: 'playBgm', path: 'bgm/town.ogg' }, {} as never),
    ).toBe('continue');
  });

  it('forwards a silent volume to a playBgm handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });

    registry.get('playBgm')?.run({ type: 'playBgm', path: 'bgm/town.ogg', volume: 0 }, {} as never);

    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { volume: 0 });
  });

  it('forwards authored playBgm volume to a handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });
    registry
      .get('playBgm')
      ?.run({ type: 'playBgm', path: 'bgm/town.ogg', volume: 0.4 }, {} as never);
    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { volume: 0.4 });
  });

  it('forwards loop false to a playBgm handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });
    registry
      .get('playBgm')
      ?.run({ type: 'playBgm', path: 'bgm/town.ogg', loop: false }, {} as never);
    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { loop: false });
  });

  it('forwards loop true to a playBgm handler', () => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });
    registry
      .get('playBgm')
      ?.run({ type: 'playBgm', path: 'bgm/town.ogg', loop: true }, {} as never);
    expect(playBgm).toHaveBeenCalledWith('bgm/town.ogg', { loop: true });
  });

  it.each([
    'volume',
    'fadeMs',
    'loop',
  ])('omits unauthored playBgm %s from handler options', (option) => {
    const playBgm = vi.fn();
    const registry = registryFor({ playBgm });

    registry.get('playBgm')?.run({ type: 'playBgm', path: 'bgm/town.ogg' }, {} as never);

    expect(playBgm).toHaveBeenCalledTimes(1);
    expect(playBgm.mock.calls[0]?.[1]).not.toHaveProperty(option);
  });

  it('rejects a non-boolean loop', () => {
    const registry = registryFor();
    expect(() =>
      parseEventScript(script({ type: 'playBgm', path: 'bgm/town.ogg', loop: 'yes' }), registry),
    ).toThrow(/"loop" must be a boolean/);
  });

  it('rejects null as a playBgm loop option', () => {
    expect(() =>
      parseEventScript(
        script({ type: 'playBgm', path: 'bgm/town.ogg', loop: null }),
        registryFor(),
      ),
    ).toThrow(/"loop" must be a boolean/);
  });

  it('parses stopBgm with no options', () => {
    const registry = registryFor();
    const parsed = parseEventScript(script({ type: 'stopBgm' }), registry);
    expect(parsed.intro).toEqual([{ type: 'stopBgm' }]);
  });

  it('omits stopBgm fadeMs when it is not authored', () => {
    const parsed = parseEventScript(script({ type: 'stopBgm' }), registryFor());

    expect(parsed.intro).toStrictEqual([{ type: 'stopBgm' }]);
  });

  it('accepts a stopBgm fade longer than one millisecond', () => {
    const parsed = parseEventScript(script({ type: 'stopBgm', fadeMs: 250 }), registryFor());
    expect(parsed.intro).toEqual([{ type: 'stopBgm', fadeMs: 250 }]);
  });

  it('preserves an authored zero stopBgm fade during parsing', () => {
    const parsed = parseEventScript(script({ type: 'stopBgm', fadeMs: 0 }), registryFor());

    expect(parsed.intro).toStrictEqual([{ type: 'stopBgm', fadeMs: 0 }]);
  });

  it('forwards stopBgm fadeMs to a handler', () => {
    const stopBgm = vi.fn();
    const registry = registryFor({ stopBgm });
    registry.get('stopBgm')?.run({ type: 'stopBgm', fadeMs: 200 }, {} as never);
    expect(stopBgm).toHaveBeenCalledWith(200);
  });

  it('continues the script after stopBgm without a playback handler', () => {
    const registry = registryFor();

    expect(registry.get('stopBgm')?.run({ type: 'stopBgm' }, {} as never)).toBe('continue');
  });

  it('rejects an escaping path through the full parse path', () => {
    const registry = registryFor();
    expect(() =>
      parseEventScript(script({ type: 'playSound', path: '../../etc/passwd' }), registry),
    ).toThrow(/".." segments/);
  });

  it('registers all three verbs without colliding', () => {
    expect(registryFor().types()).toEqual(['playSound', 'playBgm', 'stopBgm']);
  });
});
