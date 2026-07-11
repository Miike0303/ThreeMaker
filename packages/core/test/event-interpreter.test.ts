import { describe, expect, it, vi } from 'vitest';
import type { DialogueProvider, DialogueStep } from '../src/dialogue-provider.js';
import type { CardinalDirection, DialogueSource } from '../src/event-command.js';
import type { EventHost } from '../src/event-interpreter.js';
import { EventInterpreter } from '../src/event-interpreter.js';
import { PlainTextDialogueProvider } from '../src/plain-text-dialogue-provider.js';
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
  /** When set, `moveEntity` throws this instead of recording the call. */
  throwOnMove: Error | null = null;
  /** When set, `teleport` throws this instead of recording the call. */
  throwOnTeleport: Error | null = null;
  private pendingDone: (() => void) | null = null;

  moveEntity(
    entityId: string,
    direction: CardinalDirection,
    steps: number,
    done: () => void,
  ): void {
    if (this.throwOnMove) throw this.throwOnMove;
    this.moveCalls.push({ entityId, direction, steps });
    if (this.autoComplete) {
      done();
      return;
    }
    this.pendingDone = done;
  }

  teleport(entityId: string, x: number, y: number, facing?: CardinalDirection): void {
    if (this.throwOnTeleport) throw this.throwOnTeleport;
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
  /** When set, `open` throws this instead of recording the call. */
  throwOnOpen: Error | null = null;
  /** When set, `next` throws this instead of returning a queued step. */
  throwOnNext: Error | null = null;
  /** When set, `choose` throws this instead of recording the call. */
  throwOnChoose: Error | null = null;
  private steps: readonly DialogueStep[] = [];
  private cursor = 0;

  /** Configures the sequence `next()` returns for the upcoming `open()` session. */
  queueSteps(steps: readonly DialogueStep[]): void {
    this.steps = steps;
    this.cursor = 0;
  }

  open(source: DialogueSource): void {
    if (this.throwOnOpen) throw this.throwOnOpen;
    this.openCalls.push(source);
    this.cursor = 0;
  }

  next(): DialogueStep {
    if (this.throwOnNext) throw this.throwOnNext;
    const step = this.steps[this.cursor];
    if (step === undefined) return { kind: 'end' };
    this.cursor += 1;
    return step;
  }

  choose(index: number): void {
    if (this.throwOnChoose) throw this.throwOnChoose;
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

    it('finishes immediately and returns to idle for an empty script', () => {
      const { interpreter } = setup();
      const finished = vi.fn();
      interpreter.signals.on('script:finished', finished);

      interpreter.run([]);

      expect(finished).toHaveBeenCalledTimes(1);
      expect(interpreter.state).toBe('idle');
    });
  });

  describe('script:failed', () => {
    it('aborts the script, skips remaining commands, and returns to idle when the dialogue provider throws opening an unsupported source', () => {
      const world = new WorldState();
      const host = new FakeHost();
      // Real provider: only supports 'text' sources — an 'ink' source reaching it is the
      // concrete repro (e.g. a showDialogue routed to the wrong provider).
      const provider = new PlainTextDialogueProvider();
      const interpreter = new EventInterpreter({ world, host, provider });
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'setWorldVar', key: 'before', value: true },
        { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard' } },
        { type: 'setWorldVar', key: 'after', value: true },
      ]);

      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0]?.[0].error).toBeInstanceOf(Error);
      expect(interpreter.state).toBe('idle');
      expect(world.get('before')).toBe(true);
      expect(world.has('after')).toBe(false);
    });

    it('leaves the interpreter usable afterward — a subsequent script still runs to completion', () => {
      const world = new WorldState();
      const host = new FakeHost();
      const provider = new PlainTextDialogueProvider();
      const interpreter = new EventInterpreter({ world, host, provider });

      interpreter.run([{ type: 'showDialogue', source: { kind: 'ink', storyId: 'guard' } }]);
      expect(interpreter.state).toBe('idle');

      const finished = vi.fn();
      interpreter.signals.on('script:finished', finished);
      interpreter.run([{ type: 'setWorldVar', key: 'stillWorks', value: true }]);

      expect(world.get('stillWorks')).toBe(true);
      expect(finished).toHaveBeenCalledTimes(1);
    });

    it('aborts the script and returns to idle when host.moveEntity throws', () => {
      const { world, host, interpreter } = setup();
      const moveError = new Error('grid unavailable');
      host.throwOnMove = moveError;
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 },
        { type: 'setWorldVar', key: 'after', value: true },
      ]);

      expect(failed).toHaveBeenCalledWith({ error: moveError });
      expect(interpreter.state).toBe('idle');
      expect(world.has('after')).toBe(false);
    });

    it('aborts the script and returns to idle when host.teleport throws', () => {
      const { world, host, interpreter } = setup();
      const teleportError = new Error('out of bounds');
      host.throwOnTeleport = teleportError;
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'teleport', entityId: 'hero', x: 1, y: 1 },
        { type: 'setWorldVar', key: 'after', value: true },
      ]);

      expect(failed).toHaveBeenCalledWith({ error: teleportError });
      expect(interpreter.state).toBe('idle');
      expect(world.has('after')).toBe(false);
    });

    it('aborts and returns to idle when the provider throws inside next() during advance()', () => {
      const { world, interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'line', text: 'One.' }]);
      const nextError = new Error('story runtime crashed');
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'showDialogue', source: { kind: 'text', lines: ['One.'] } },
        { type: 'setWorldVar', key: 'after', value: true },
      ]);
      provider.throwOnNext = nextError;
      interpreter.advance();

      expect(failed).toHaveBeenCalledWith({ error: nextError });
      expect(interpreter.state).toBe('idle');
      expect(world.has('after')).toBe(false);
    });

    it('aborts and returns to idle when the provider throws inside choose()', () => {
      const { world, interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }]);
      const chooseError = new Error('story runtime crashed');
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'showDialogue', source: { kind: 'text', lines: [] } },
        { type: 'setWorldVar', key: 'after', value: true },
      ]);
      provider.throwOnChoose = chooseError;
      interpreter.choose(0);

      expect(failed).toHaveBeenCalledWith({ error: chooseError });
      expect(interpreter.state).toBe('idle');
      expect(world.has('after')).toBe(false);
    });

    it('drains a script that was already queued once the failing script aborts', () => {
      const { world, host, interpreter, provider } = setup();
      host.autoComplete = false;
      const openError = new Error('dialogue backend unavailable');
      const failed = vi.fn();
      interpreter.signals.on('script:failed', failed);

      interpreter.run([
        { type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1 },
        { type: 'showDialogue', source: { kind: 'text', lines: ['x'] } },
      ]);
      interpreter.run([{ type: 'setWorldVar', key: 'queuedRan', value: true }]);
      expect(interpreter.queueLength).toBe(1);

      provider.throwOnOpen = openError;
      host.completeMove();

      expect(failed).toHaveBeenCalledWith({ error: openError });
      expect(world.get('queuedRan')).toBe(true);
      expect(interpreter.queueLength).toBe(0);
    });
  });

  describe('choose() bounds validation', () => {
    it('throws for a negative index without calling provider.choose()', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }]);
      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);

      expect(() => interpreter.choose(-1)).toThrow(
        'EventInterpreter: choose(-1) is out of bounds — expected an integer in [0, 2).',
      );
      expect(provider.chooseCalls).toEqual([]);
    });

    it('throws for a non-integer index without calling provider.choose()', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }]);
      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);

      expect(() => interpreter.choose(0.5)).toThrow(
        'EventInterpreter: choose(0.5) is out of bounds — expected an integer in [0, 2).',
      );
      expect(provider.chooseCalls).toEqual([]);
    });

    it('throws for an index >= the number of options without calling provider.choose()', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }]);
      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);

      expect(() => interpreter.choose(2)).toThrow(
        'EventInterpreter: choose(2) is out of bounds — expected an integer in [0, 2).',
      );
      expect(provider.chooseCalls).toEqual([]);
    });

    it('accepts a valid index at the upper bound (length - 1)', () => {
      const { interpreter, provider } = setup();
      provider.queueSteps([{ kind: 'choices', options: ['Yes', 'No'] }, { kind: 'end' }]);
      interpreter.run([{ type: 'showDialogue', source: { kind: 'text', lines: [] } }]);

      expect(() => interpreter.choose(1)).not.toThrow();
      expect(provider.chooseCalls).toEqual([1]);
    });
  });
});
