import { describe, expect, it, vi } from 'vitest';
import { parseEventScript } from '../src/event-command.js';
import type { EventHost } from '../src/event-interpreter.js';
import { EventInterpreter } from '../src/event-interpreter.js';
import { PlainTextDialogueProvider } from '../src/plain-text-dialogue-provider.js';
import { type CommandPlugin, CommandRegistry } from '../src/plugin.js';
import { WorldState } from '../src/world-state.js';

/** Host stub: plugin dispatch never touches these, but the interpreter requires one. */
const noopHost: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: () => {},
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

function makeInterpreter(plugins: CommandRegistry, world = new WorldState()) {
  return {
    world,
    interpreter: new EventInterpreter({
      world,
      host: noopHost,
      provider: new PlainTextDialogueProvider(),
      plugins,
    }),
  };
}

/** Synchronous plugin: writes a world var so a test can observe it ran. */
const syncPlugin: CommandPlugin = {
  type: 'shout',
  parse(value, path) {
    const { text } = value;
    if (typeof text !== 'string') throw new Error(`${path} requires a string "text".`);
    return { type: 'shout', text };
  },
  run(command, ctx) {
    ctx.world.set('lastShout', command.text as string);
    return 'continue';
  },
};

describe('CommandRegistry', () => {
  it('rejects a plugin claiming a builtin command type', () => {
    const registry = new CommandRegistry();
    expect(() => registry.register({ ...syncPlugin, type: 'teleport' })).toThrow(
      /builtin command type/,
    );
  });

  it('rejects a duplicate registration', () => {
    const registry = new CommandRegistry();
    registry.register(syncPlugin);
    expect(() => registry.register(syncPlugin)).toThrow(/already registered/);
  });

  it('rejects an empty type', () => {
    const registry = new CommandRegistry();
    expect(() => registry.register({ ...syncPlugin, type: '' })).toThrow(/non-empty string/);
  });
});

describe('parseEventScript with a registry', () => {
  const script = (command: unknown) => ({ version: 1, events: { intro: [command] } });

  it('rejects an unknown command type when no registry is passed', () => {
    expect(() => parseEventScript(script({ type: 'shout', text: 'hi' }))).toThrow(
      /unknown command type "shout"/,
    );
  });

  it('accepts a registered plugin command', () => {
    const registry = new CommandRegistry();
    registry.register(syncPlugin);
    const parsed = parseEventScript(script({ type: 'shout', text: 'hi' }), registry);
    expect(parsed.intro).toEqual([{ type: 'shout', text: 'hi' }]);
  });

  it("surfaces the plugin's own validation failure", () => {
    const registry = new CommandRegistry();
    registry.register(syncPlugin);
    expect(() => parseEventScript(script({ type: 'shout', text: 42 }), registry)).toThrow(
      /requires a string "text"/,
    );
  });

  it('parses plugin commands nested inside a conditional branch', () => {
    const registry = new CommandRegistry();
    registry.register(syncPlugin);
    const parsed = parseEventScript(
      script({
        type: 'conditional',
        if: { key: 'flag', op: 'eq', value: true },
        then: [{ type: 'shout', text: 'yes' }],
        else: [{ type: 'shout', text: 'no' }],
      }),
      registry,
    );
    expect(parsed.intro?.[0]).toMatchObject({
      then: [{ type: 'shout', text: 'yes' }],
      else: [{ type: 'shout', text: 'no' }],
    });
  });

  it('rejects a plugin that returns a mismatched type', () => {
    const registry = new CommandRegistry();
    registry.register({
      type: 'liar',
      parse: () => ({ type: 'somethingElse' }),
      run: () => 'continue',
    });
    expect(() => parseEventScript(script({ type: 'liar' }), registry)).toThrow(
      /returned a command typed "somethingElse"/,
    );
  });
});

describe('EventInterpreter plugin dispatch', () => {
  it("runs a sync plugin and continues to the script's next command", () => {
    const registry = new CommandRegistry();
    registry.register(syncPlugin);
    const { world, interpreter } = makeInterpreter(registry);

    const parsed = parseEventScript(
      {
        version: 1,
        events: {
          intro: [
            { type: 'shout', text: 'hello' },
            { type: 'setWorldVar', key: 'after', value: true },
          ],
        },
      },
      registry,
    );
    interpreter.run(parsed.intro ?? []);

    expect(world.get('lastShout')).toBe('hello');
    expect(world.get('after')).toBe(true);
    expect(interpreter.state).toBe('idle');
  });

  it('blocks on a waiting plugin until done() resumes the script', () => {
    let resume: (() => void) | null = null;
    const registry = new CommandRegistry();
    registry.register({
      type: 'wait',
      parse: () => ({ type: 'wait' }),
      run: (_command, ctx) => {
        resume = ctx.done;
        return 'wait';
      },
    });
    const { world, interpreter } = makeInterpreter(registry);

    interpreter.run([
      { type: 'wait' } as never,
      { type: 'setWorldVar', key: 'after', value: true },
    ]);

    expect(world.get('after')).toBeUndefined();
    expect(interpreter.state).toBe('running');

    resume?.();
    expect(world.get('after')).toBe(true);
    expect(interpreter.state).toBe('idle');
  });

  it('advances the script once when a waiting plugin calls done() twice', () => {
    const seen: number[] = [];
    const registry = new CommandRegistry();
    registry.register({
      type: 'doubleDone',
      parse: () => ({ type: 'doubleDone' }),
      run: (_command, ctx) => {
        queueMicrotask(() => {
          ctx.done();
          ctx.done();
        });
        return 'wait';
      },
    });
    registry.register({
      type: 'tally',
      parse: () => ({ type: 'tally' }),
      run: () => {
        seen.push(1);
        return 'continue';
      },
    });
    const { interpreter } = makeInterpreter(registry);

    interpreter.run([{ type: 'doubleDone' } as never, { type: 'tally' } as never]);

    return Promise.resolve().then(() => {
      expect(seen).toEqual([1]);
      expect(interpreter.state).toBe('idle');
    });
  });

  it("ignores a done() from a plugin that returned 'continue'", () => {
    const seen: string[] = [];
    const registry = new CommandRegistry();
    registry.register({
      type: 'greedy',
      parse: () => ({ type: 'greedy' }),
      run: (_command, ctx) => {
        ctx.done();
        return 'continue';
      },
    });
    registry.register({
      type: 'tally',
      parse: () => ({ type: 'tally' }),
      run: () => {
        seen.push('tally');
        return 'continue';
      },
    });
    const { interpreter } = makeInterpreter(registry);

    interpreter.run([{ type: 'greedy' } as never, { type: 'tally' } as never]);

    expect(seen).toEqual(['tally']);
    expect(interpreter.state).toBe('idle');
  });

  it('fails the script when a plugin throws', () => {
    const registry = new CommandRegistry();
    registry.register({
      type: 'boom',
      parse: () => ({ type: 'boom' }),
      run: () => {
        throw new Error('plugin exploded');
      },
    });
    const { interpreter } = makeInterpreter(registry);
    const onFailed = vi.fn();
    interpreter.signals.on('script:failed', onFailed);

    interpreter.run([{ type: 'boom' } as never]);

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(interpreter.state).toBe('idle');
  });

  it('fails the script when no plugin handles the command type', () => {
    const { interpreter } = makeInterpreter(new CommandRegistry());
    const onFailed = vi.fn();
    interpreter.signals.on('script:failed', onFailed);

    interpreter.run([{ type: 'ghost' } as never]);

    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
