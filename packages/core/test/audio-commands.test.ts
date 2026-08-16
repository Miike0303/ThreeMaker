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
    expect(registry.get('playSound')?.run({ type: 'playSound', path: 'se/hit.ogg' }, {} as never)).toBe(
      'continue',
    );
  });

  it('forwards playSound to a handler when provided', () => {
    const playSound = vi.fn();
    const registry = registryFor({ playSound });
    registry.get('playSound')?.run({ type: 'playSound', path: 'se/hit.ogg', volume: 0.5 }, {} as never);
    expect(playSound).toHaveBeenCalledWith('se/hit.ogg', 0.5);
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

  it('rejects a non-boolean loop', () => {
    const registry = registryFor();
    expect(() =>
      parseEventScript(script({ type: 'playBgm', path: 'bgm/town.ogg', loop: 'yes' }), registry),
    ).toThrow(/"loop" must be a boolean/);
  });

  it('parses stopBgm with no options', () => {
    const registry = registryFor();
    const parsed = parseEventScript(script({ type: 'stopBgm' }), registry);
    expect(parsed.intro).toEqual([{ type: 'stopBgm' }]);
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
