import { describe, expect, it, vi } from 'vitest';
import type { DialogueProvider, DialogueStep } from '../src/dialogue-provider.js';
import type { CardinalDirection, DialogueSource } from '../src/event-command.js';
import type { EventHost } from '../src/event-interpreter.js';
import { EventInterpreter } from '../src/event-interpreter.js';
import { WorldState } from '../src/world-state.js';

class FakeHost implements EventHost {
  readonly moveCalls: { entityId: string; direction: CardinalDirection; steps: number }[] = [];
  readonly teleportCalls: {
    entityId: string;
    x: number;
    y: number;
    facing?: CardinalDirection;
  }[] = [];
  /** When true (default), `moveEntity` calls `done()` synchronously. Set to false to hold it open and call `completeMove()` manually. */
  autoComplete = true;
  private pendingDone: (() => void) | null = null;

  moveEntity(
    entityId: string,
    direction: CardinalDirection,
    steps: number,
    done: () => void,
  ): void {
    this.moveCalls.push({ entityId, direction, steps });
    if (this.autoComplete) {
      done();
      return;
    }
    this.pendingDone = done;
  }

  teleport(entityId: string, x: number, y: number, facing?: CardinalDirection): void {
    this.teleportCalls.push(facing !== undefined ? { entityId, x, y, facing } : { entityId, x, y });
  }

  /** Simulates the host reporting move completion (e.g. after a partial, blocked move). */
  completeMove(): void {
    const done = this.pendingDone;
    this.pendingDone = null;
    done?.();
  }
}

class FakeProvider implements DialogueProvider {
  readonly openCalls: DialogueSource[] = [];
  readonly chooseCalls: number[] = [];
  private steps: readonly DialogueStep[] = [];
  private cursor = 0;

  /** Configures the sequence `next()` returns for the upcoming `open()` session. */
  queueSteps(steps: readonly DialogueStep[]): void {
    this.steps = steps;
    this.cursor = 0;
  }

  open(source: DialogueSource): void {
    this.openCalls.push(source);
    this.cursor = 0;
  }

  next(): DialogueStep {
    const step = this.steps[this.cursor];
    if (step === undefined) return { kind: 'end' };
    this.cursor += 1;
    return step;
  }

  choose(index: number): void {
    this.chooseCalls.push(index);
  }
}

function setup() {
  const world = new WorldState();
  const host = new FakeHost();
  const provider = new FakeProvider();
  const interpreter = new EventInterpreter({ world, host, provider });
  return { world, host, provider, interpreter };
}

describe('EventInterpreter', () => {
  describe('setWorldVar', () => {
    it('applies immediately and the script finishes synchronously', () => {
      const { world, interpreter } = setup();
      const finished = vi.fn();
      interpreter.signals.on('script:finished', finished);

      interpreter.run([{ type: 'setWorldVar', key: 'gold', value: 10 }]);

      expect(world.get('gold')).toBe(10);
      expect(interpreter.state).toBe('idle');
      expect(finished).toHaveBeenCalledTimes(1);
    });
  });

  describe('teleport', () => {
    it('calls host.teleport with entity, position, and facing', () => {
      const { host, interpreter } = setup();

      interpreter.run([{ type: 'teleport', entityId: 'hero', x: 3, y: 4, facing: 'down' }]);

      expect(host.teleportCalls).toEqual([{ entityId: 'hero', x: 3, y: 4, facing: 'down' }]);
    });

    it('omits facing when the command does not specify one', () => {
      const { host, interpreter } = setup();

      interpreter.run([{ type: 'teleport', entityId: 'hero', x: 3, y: 4 }]);

      expect(host.teleportCalls).toEqual([{ entityId: 'hero', x: 3, y: 4 }]);
    });
  });

  describe('moveEntity', () => {
    it('calls host.moveEntity and stays running until done() is called', () => {
      const { host, interpreter } = setup();
      host.autoComplete = false;

      interpreter.run([{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 3 }]);

      expect(host.moveCalls).toEqual([{ entityId: 'hero', direction: 'up', steps: 3 }]);
      expect(interpreter.state).toBe('running');

      host.completeMove();

      expect(interpreter.state).toBe('idle');
    });

    it('continues the script when the host reports done after only a partial move', () => {
      const { world, host, interpreter } = setup();
      host.autoComplete = false;

      interpreter.run([
        { type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 5 },
        { type: 'setWorldVar', key: 'movedPartially', value: true },
      ]);

      expect(world.has('movedPartially')).toBe(false);

      // Host only managed 2 of the requested 5 steps (blocked partway) but still reports done.
      host.completeMove();

      expect(world.get('movedPartially')).toBe(true);
      expect(interpreter.state).toBe('idle');
    });
  });

  describe('showDialogue', () => {
    it('enters waiting-for-dialogue and emits dialogue:line for a line step', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'line', text: 'Hello there.' }]);
      const onLine = vi.fn();
      interpreter.signals.on('dialogue:line', onLine);

      interpreter.run([
        {
          type: 'showDialogue',
          speaker: 'Elder',
          source: { kind: 'text', lines: ['Hello there.'] },
        },
      ]);

      expect(interpreter.state).toBe('waiting-for-dialogue');
      expect(onLine).toHaveBeenCalledWith({ speaker: 'Elder', text: 'Hello there.' });
    });

    it('prefers the dialogue step speaker over the command speaker', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'line', speaker: 'Narrator', text: 'Once upon a time.' }]);
      const onLine = vi.fn();
      interpreter.signals.on('dialogue:line', onLine);

      interpreter.run([
        { type: 'showDialogue', speaker: 'Elder', source: { kind: 'text', lines: ['x'] } },
      ]);

      expect(onLine).toHaveBeenCalledWith({ speaker: 'Narrator', text: 'Once upon a time.' });
    });

    it('omits speaker from the dialogue:line payload when neither the step nor the command has one', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'line', text: 'No speaker.' }]);
      const onLine = vi.fn();
      interpreter.signals.on('dialogue:line', onLine);

      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: ['x'] } }]);

      expect(onLine).toHaveBeenCalledWith({ text: 'No speaker.' });
    });

    it('advance() steps through multiple lines, then closes and continues the script on end', () => {
      const { world, interpreter, provider } = setup();
      provider.queueSteps([
        { kind: 'line', text: 'One.' },
        { kind: 'line', text: 'Two.' },
      ]);
      const onClosed = vi.fn();
      interpreter.signals.on('dialogue:closed', onClosed);

      interpreter.run([
        { type: 'showDialogue', source: { kind: 'text', lines: ['One.', 'Two.'] } },
        { type: 'setWorldVar', key: 'talkedToElder', value: true },
      ]);

      expect(interpreter.state).toBe('waiting-for-dialogue');
      interpreter.advance();
      expect(interpreter.state).toBe('waiting-for-dialogue');
      interpreter.advance();

      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(interpreter.state).toBe('idle');
      expect(world.get('talkedToElder')).toBe(true);
    });

    it('enters waiting-for-choice and emits dialogue:choices for a choices step', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }]);
      const onChoices = vi.fn();
      interpreter.signals.on('dialogue:choices', onChoices);

      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);

      expect(interpreter.state).toBe('waiting-for-choice');
      expect(onChoices).toHaveBeenCalledWith({ options: ['Yes', 'No'] });
    });

    it('choose() forwards the index to the provider and advances past the choice', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }, { kind: 'end' }]);
      const onClosed = vi.fn();
      interpreter.signals.on('dialogue:closed', onClosed);

      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);
      interpreter.choose(1);

      expect(provider.chooseCalls).toEqual([1]);
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(interpreter.state).toBe('idle');
    });

    it('advance() throws when not waiting for dialogue', () => {
      const { interpreter } = setup();

      expect(() => interpreter.advance()).toThrow(
        "EventInterpreter: advance() called while not waiting for dialogue (state: 'idle').",
      );
    });

    it('choose() throws when not waiting for a choice', () => {
      const { interpreter } = setup();

      expect(() => interpreter.choose(0)).toThrow(
        "EventInterpreter: choose() called while not waiting for a choice (state: 'idle').",
      );
    });
  });

  describe('conditional', () => {
    it('runs the "then" branch when the condition matches', () => {
      const { world, interpreter } = setup();
      world.set('metElder', true);

      interpreter.run([
        {
          type: 'conditional',
          if: { key: 'metElder', op: 'eq', value: true },
          then: [{ type: 'setWorldVar', key: 'gold', value: 10 }],
          else: [{ type: 'setWorldVar', key: 'gold', value: 0 }],
        },
      ]);

      expect(world.get('gold')).toBe(10);
    });

    it('runs the "else" branch when the condition does not match', () => {
      const { world, interpreter } = setup();
      world.set('metElder', false);

      interpreter.run([
        {
          type: 'conditional',
          if: { key: 'metElder', op: 'eq', value: true },
          then: [{ type: 'setWorldVar', key: 'gold', value: 10 }],
          else: [{ type: 'setWorldVar', key: 'gold', value: 0 }],
        },
      ]);

      expect(world.get('gold')).toBe(0);
    });

    it('does nothing when the condition does not match and there is no "else"', () => {
      const { world, interpreter } = setup();

      interpreter.run([
        {
          type: 'conditional',
          if: { key: 'metElder', op: 'eq', value: true },
          then: [{ type: 'setWorldVar', key: 'gold', value: 10 }],
        },
      ]);

      expect(world.has('gold')).toBe(false);
      expect(interpreter.state).toBe('idle');
    });

    it('evaluates "neq" against a non-number value without throwing', () => {
      const { world, interpreter } = setup();
      world.set('rank', 'novice');

      interpreter.run([
        {
          type: 'conditional',
          if: { key: 'rank', op: 'neq', value: 'master' },
          then: [{ type: 'setWorldVar', key: 'promoted', value: true }],
        },
      ]);

      expect(world.get('promoted')).toBe(true);
    });

    it.each([
      ['lt', 5, 10, true],
      ['lte', 10, 10, true],
      ['gt', 15, 10, true],
      ['gte', 10, 10, true],
    ] as const)('evaluates numeric operator "%s" correctly', (op, worldValue, compareValue, expected) => {
      const { world, interpreter } = setup();
      world.set('gold', worldValue);

      interpreter.run([
        {
          type: 'conditional',
          if: { key: 'gold', op, value: compareValue },
          then: [{ type: 'setWorldVar', key: 'matched', value: true }],
          else: [{ type: 'setWorldVar', key: 'matched', value: false }],
        },
      ]);

      expect(world.get('matched')).toBe(expected);
    });

    it('throws when a numeric operator is used against a non-number world value', () => {
      const { world, interpreter } = setup();
      world.set('rank', 'novice');

      expect(() =>
        interpreter.run([
          {
            type: 'conditional',
            if: { key: 'rank', op: 'gt', value: 5 },
            then: [],
          },
        ]),
      ).toThrow(
        'EventInterpreter: conditional operator "gt" requires a number for key "rank", got string compared to number.',
      );
    });

    it('throws when a numeric operator is used against a non-number comparison value', () => {
      const { world, interpreter } = setup();
      world.set('gold', 10);

      expect(() =>
        interpreter.run([
          {
            type: 'conditional',
            // biome-ignore lint/suspicious/noExplicitAny: intentionally malformed value to exercise the runtime numeric guard
            if: { key: 'gold', op: 'gt', value: 'lots' as any },
            then: [],
          },
        ]),
      ).toThrow(
        'EventInterpreter: conditional operator "gt" requires a number for key "gold", got number compared to string.',
      );
    });
  });

  describe('FIFO pending queue', () => {
    it('starts a script immediately when idle with an empty queue, without emitting script:enqueued', () => {
      const { interpreter } = setup();
      const onEnqueued = vi.fn();
      interpreter.signals.on('script:enqueued', onEnqueued);

      interpreter.run([{ type: 'setWorldVar', key: 'a', value: 1 }]);

      expect(onEnqueued).not.toHaveBeenCalled();
      expect(interpreter.queueLength).toBe(0);
    });

    it('enqueues a script triggered while another is running, preserving it instead of dropping it', () => {
      const { world, host, interpreter } = setup();
      host.autoComplete = false;
      const onEnqueued = vi.fn();
      interpreter.signals.on('script:enqueued', onEnqueued);

      interpreter.run([{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 }]);
      interpreter.run([{ type: 'setWorldVar', key: 'secondScriptRan', value: true }]);

      expect(onEnqueued).toHaveBeenCalledWith({ queueLength: 1 });
      expect(interpreter.queueLength).toBe(1);
      expect(world.has('secondScriptRan')).toBe(false);

      host.completeMove();

      expect(world.get('secondScriptRan')).toBe(true);
      expect(interpreter.queueLength).toBe(0);
    });

    it('enqueues a script triggered while waiting for dialogue', () => {
      const { world, interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'line', text: 'Hello.' }]);

      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: ['Hello.'] } }]);
      interpreter.run([{ type: 'setWorldVar', key: 'queuedDuringDialogue', value: true }]);

      expect(interpreter.queueLength).toBe(1);
      expect(world.has('queuedDuringDialogue')).toBe(false);

      interpreter.advance();

      expect(world.get('queuedDuringDialogue')).toBe(true);
    });

    it('drains multiple enqueued scripts in FIFO order', () => {
      const { world, host, interpreter } = setup();
      host.autoComplete = false;
      const order: string[] = [];
      world.signals.on('changed', ({ key }) => order.push(key));

      interpreter.run([{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 }]);
      interpreter.run([{ type: 'setWorldVar', key: 'first', value: true }]);
      interpreter.run([{ type: 'setWorldVar', key: 'second', value: true }]);

      expect(interpreter.queueLength).toBe(2);

      host.completeMove();

      expect(order).toEqual(['first', 'second']);
      expect(interpreter.queueLength).toBe(0);
    });
  });

  describe('state:changed', () => {
    it('emits a transition for every distinct state change and none for repeats', () => {
      const { host, interpreter, provider } = setup();
      host.autoComplete = false;
      provider.queueSteps([{ kind: 'line', text: 'Hi.' }]);
      const transitions: string[] = [];
      interpreter.signals.on('state:changed', ({ state }) => transitions.push(state));

      interpreter.run([
        { type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 },
        { type: 'showDialogue', source: { kind: 'text', lines: ['Hi.'] } },
      ]);
      host.completeMove();
      interpreter.advance();

      expect(transitions).toEqual(['running', 'waiting-for-dialogue', 'running', 'idle']);
    });
  });

  describe('script:finished', () => {
    it('emits exactly once when a script completes', () => {
      const { interpreter } = setup();
      const finished = vi.fn();
      interpreter.signals.on('script:finished', finished);

      interpreter.run([{ type: 'setWorldVar', key: 'a', value: 1 }]);

      expect(finished).toHaveBeenCalledTimes(1);
    });

    it('emits once per script when multiple scripts run back to back via the queue', () => {
      const { host, interpreter } = setup();
      host.autoComplete = false;
      const finished = vi.fn();
      interpreter.signals.on('script:finished', finished);

      interpreter.run([{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 }]);
      interpreter.run([{ type: 'setWorldVar', key: 'a', value: 1 }]);
      host.completeMove();

      expect(finished).toHaveBeenCalledTimes(2);
    });
  });
});
