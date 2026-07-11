import type { DialogueProvider } from './dialogue-provider.js';
import type {
  CardinalDirection,
  ConditionalCommand,
  EventCommand,
  ShowDialogueCommand,
} from './event-command.js';
import { SignalBus, type SignalSubscriber } from './signal-bus.js';
import type { WorldState } from './world-state.js';

/** Coarse execution state of an {@link EventInterpreter}. */
export type InterpreterState = 'idle' | 'running' | 'waiting-for-dialogue' | 'waiting-for-choice';

/**
 * App-supplied effects for the commands an {@link EventInterpreter} cannot
 * perform itself (movement and teleport touch the grid/renderer, which core
 * doesn't know about).
 */
export interface EventHost {
  /**
   * Move `entityId` `steps` tiles toward `direction`. Must call `done()`
   * exactly once, however many steps actually landed (a partial, blocked
   * move is non-fatal — the script continues regardless of how far the
   * entity got).
   */
  moveEntity(entityId: string, direction: CardinalDirection, steps: number, done: () => void): void;
  /** Place `entityId` at `(x, y)`, optionally setting its facing. Immediate, no callback. */
  teleport(entityId: string, x: number, y: number, facing?: CardinalDirection): void;
}

export type EventInterpreterEvents = {
  'state:changed': { state: InterpreterState };
  'script:enqueued': { queueLength: number };
  'dialogue:line': { speaker?: string; text: string };
  'dialogue:choices': { options: readonly string[] };
  'dialogue:closed': Record<string, never>;
  'script:finished': Record<string, never>;
  /**
   * Fires when the `EventHost` or `DialogueProvider` throws synchronously
   * while executing a command (e.g. a dialogue backend rejecting an
   * unsupported source, or a host failing to resolve an entity). The
   * current script is aborted at that point — every command after the one
   * that failed is skipped, not retried or resumed — and the interpreter
   * returns to `idle` and drains its pending queue, so a single bad script
   * never wedges later scripts.
   */
  'script:failed': { error: unknown };
};

function evaluateCondition(world: WorldState, condition: ConditionalCommand['if']): boolean {
  const actual = world.get(condition.key);
  const { op, value } = condition;

  if (op === 'eq') return actual === value;
  if (op === 'neq') return actual !== value;

  if (typeof actual !== 'number' || typeof value !== 'number') {
    throw new Error(
      `EventInterpreter: conditional operator "${op}" requires a number for key "${condition.key}", got ${typeof actual} compared to ${typeof value}.`,
    );
  }
  switch (op) {
    case 'lt':
      return actual < value;
    case 'lte':
      return actual <= value;
    case 'gt':
      return actual > value;
    case 'gte':
      return actual >= value;
  }
}

/**
 * Headless state machine that executes {@link EventCommand} scripts:
 * moving/teleporting entities via the host, mutating {@link WorldState},
 * branching on `conditional`, and driving a {@link DialogueProvider} through
 * `showDialogue`. Runs one script at a time; concurrent `run()` calls queue
 * (FIFO) instead of interleaving, and are drained automatically whenever the
 * interpreter returns to `idle`. No nested/parallel event support in v1.
 */
export class EventInterpreter {
  /** Subscribe to interpreter lifecycle and dialogue events. Emission is a private implementation detail. */
  readonly signals: SignalSubscriber<EventInterpreterEvents>;

  private readonly bus = new SignalBus<EventInterpreterEvents>();
  private readonly world: WorldState;
  private readonly host: EventHost;
  private readonly provider: DialogueProvider;

  private _state: InterpreterState = 'idle';
  private readonly pendingQueue: (readonly EventCommand[])[] = [];
  private currentCommands: readonly EventCommand[] = [];
  private currentIndex = 0;
  private activeDialogueCommand: ShowDialogueCommand | null = null;
  /** Number of options in the most recently emitted `dialogue:choices`, or `null` when not `waiting-for-choice`. Used to bounds-check `choose()`. */
  private pendingChoiceCount: number | null = null;

  constructor(opts: { world: WorldState; host: EventHost; provider: DialogueProvider }) {
    this.world = opts.world;
    this.host = opts.host;
    this.provider = opts.provider;
    this.signals = this.bus;
  }

  /** Current coarse execution state. */
  get state(): InterpreterState {
    return this._state;
  }

  /** Number of scripts currently waiting in the FIFO queue (excludes the one running now, if any). */
  get queueLength(): number {
    return this.pendingQueue.length;
  }

  /**
   * Run `commands` as a script. If the interpreter is `idle` with an empty
   * queue, starts immediately; otherwise the script is appended to the FIFO
   * queue and emits `script:enqueued`, to be drained once the interpreter
   * next reaches `idle`.
   */
  run(commands: readonly EventCommand[]): void {
    if (this._state === 'idle' && this.pendingQueue.length === 0) {
      this.startScript(commands);
      return;
    }
    this.pendingQueue.push(commands);
    this.bus.emit('script:enqueued', { queueLength: this.pendingQueue.length });
  }

  /** Advance past the current dialogue line. Throws unless `state` is `waiting-for-dialogue`. */
  advance(): void {
    if (this._state !== 'waiting-for-dialogue') {
      throw new Error(
        `EventInterpreter: advance() called while not waiting for dialogue (state: '${this._state}').`,
      );
    }
    if (this.stepDialogue() === 'unblocked') this.continueScript();
  }

  /**
   * Select choice `index` from the current `dialogue:choices`. Throws
   * unless `state` is `waiting-for-choice`, or `index` is not an integer in
   * range `[0, options.length)` — the bounds check runs before the
   * provider is touched, so an invalid index never reaches it.
   */
  choose(index: number): void {
    if (this._state !== 'waiting-for-choice') {
      throw new Error(
        `EventInterpreter: choose() called while not waiting for a choice (state: '${this._state}').`,
      );
    }
    const count = this.pendingChoiceCount ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(
        `EventInterpreter: choose(${index}) is out of bounds — expected an integer in [0, ${count}).`,
      );
    }
    try {
      this.provider.choose(index);
    } catch (error) {
      this.failScript(error);
      return;
    }
    if (this.stepDialogue() === 'unblocked') this.continueScript();
  }

  private setState(next: InterpreterState): void {
    if (this._state === next) return;
    this._state = next;
    this.bus.emit('state:changed', { state: next });
  }

  private startScript(commands: readonly EventCommand[]): void {
    this.currentCommands = commands;
    this.currentIndex = 0;
    this.setState('running');
    this.continueScript();
  }

  /**
   * Steps the current dialogue session once. Returns `'blocked'` if it
   * entered a line/choices step, `'unblocked'` if the session ended, or
   * `'failed'` if `provider.next()` threw — in which case `failScript()`
   * has already run and the caller must not do anything further.
   */
  private stepDialogue(): 'blocked' | 'unblocked' | 'failed' {
    let step: ReturnType<DialogueProvider['next']>;
    try {
      step = this.provider.next();
    } catch (error) {
      this.failScript(error);
      return 'failed';
    }
    switch (step.kind) {
      case 'line': {
        this.setState('waiting-for-dialogue');
        this.pendingChoiceCount = null;
        const speaker = step.speaker ?? this.activeDialogueCommand?.speaker;
        this.bus.emit(
          'dialogue:line',
          speaker !== undefined ? { speaker, text: step.text } : { text: step.text },
        );
        return 'blocked';
      }
      case 'choices':
        this.setState('waiting-for-choice');
        this.pendingChoiceCount = step.options.length;
        this.bus.emit('dialogue:choices', { options: step.options });
        return 'blocked';
      case 'end':
        this.setState('running');
        this.activeDialogueCommand = null;
        this.pendingChoiceCount = null;
        this.bus.emit('dialogue:closed', {});
        return 'unblocked';
    }
  }

  /**
   * Executes commands synchronously from `currentIndex` until the script
   * finishes, blocks (moveEntity/dialogue), or fails.
   *
   * ponytail: blocking commands resume via direct recursive calls back into
   * `continueScript()` (a `moveEntity` `done()` callback, or `advance()`/
   * `choose()` after a dialogue step) rather than a trampoline/explicit
   * work-stack. Fine for v1's script lengths; a script with an extremely
   * deep synchronous chain of moves/dialogue steps could in principle hit
   * the call-stack limit. If that ever becomes a real constraint, the fix
   * is a trampoline (an explicit loop draining a work queue instead of
   * recursive calls), not a change to the public API.
   */
  private continueScript(): void {
    while (this.currentIndex < this.currentCommands.length) {
      const command = this.currentCommands[this.currentIndex];
      this.currentIndex += 1;
      if (command === undefined) continue;

      switch (command.type) {
        case 'setWorldVar':
          this.world.set(command.key, command.value);
          continue;

        case 'teleport':
          try {
            this.host.teleport(command.entityId, command.x, command.y, command.facing);
          } catch (error) {
            this.failScript(error);
            return;
          }
          continue;

        case 'conditional': {
          const matched = evaluateCondition(this.world, command.if);
          const branch = matched ? command.then : (command.else ?? []);
          this.currentCommands = [...branch, ...this.currentCommands.slice(this.currentIndex)];
          this.currentIndex = 0;
          continue;
        }

        case 'moveEntity':
          try {
            this.host.moveEntity(command.entityId, command.direction, command.steps, () => {
              this.continueScript();
            });
          } catch (error) {
            this.failScript(error);
            return;
          }
          return;

        case 'showDialogue': {
          this.activeDialogueCommand = command;
          try {
            this.provider.open(command.source);
          } catch (error) {
            this.failScript(error);
            return;
          }
          if (this.stepDialogue() === 'unblocked') continue;
          return;
        }
      }
    }

    this.finishScript();
  }

  private finishScript(): void {
    this.activeDialogueCommand = null;
    this.currentCommands = [];
    this.currentIndex = 0;
    this.pendingChoiceCount = null;
    this.bus.emit('script:finished', {});
    this.setState('idle');
    this.drainQueueIfIdle();
  }

  /**
   * Aborts the current script after a host/provider call threw: the
   * remaining commands are skipped (not resumed later), `script:failed`
   * fires with the error, and the interpreter returns to `idle` and drains
   * its queue so subsequent scripts are unaffected.
   */
  private failScript(error: unknown): void {
    this.activeDialogueCommand = null;
    this.currentCommands = [];
    this.currentIndex = 0;
    this.pendingChoiceCount = null;
    this.bus.emit('script:failed', { error });
    this.setState('idle');
    this.drainQueueIfIdle();
  }

  private drainQueueIfIdle(): void {
    if (this._state !== 'idle') return;
    const next = this.pendingQueue.shift();
    if (next === undefined) return;
    this.startScript(next);
  }
}
