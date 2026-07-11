import { SignalBus, type SignalSubscriber } from './signal-bus.js';

/** Value types storable in a {@link WorldState}. Content-authored data (JSON), not TS-schema-checked. */
export type WorldValue = boolean | number | string;

export type WorldStateEvents = {
  changed: { key: string; value: WorldValue; previous: WorldValue | undefined };
};

/**
 * Shared, typed key/value store for narrative and gameplay state (e.g. flags,
 * counters, dialogue variables). A key's runtime type locks on its first
 * `set()` — later sets with a mismatched type throw, catching content bugs
 * early since keys are authored as data (JSON/ink), not statically typed.
 */
export class WorldState {
  /**
   * Subscribe to state changes. `changed` fires only as a direct result of
   * a successful `set()` call — never from a failed (type-mismatched) set,
   * and never forgeable by consumers: this field exposes subscription
   * methods only (`on`/`off`/`once`), not `emit`.
   */
  readonly signals: SignalSubscriber<WorldStateEvents>;

  private readonly bus = new SignalBus<WorldStateEvents>();
  private readonly values = new Map<string, WorldValue>();

  constructor() {
    this.signals = this.bus;
  }

  /** Read the current value for `key`, or `undefined` if it was never set. */
  get(key: string): WorldValue | undefined {
    return this.values.get(key);
  }

  /**
   * Set `key` to `value`. The first `set()` for a key locks its type; a
   * later `set()` with a different type throws instead of silently
   * overwriting.
   */
  set(key: string, value: WorldValue): void {
    const previous = this.values.get(key);
    if (previous !== undefined && typeof previous !== typeof value) {
      throw new Error(
        `WorldState: key '${key}' is locked to type '${typeof previous}', cannot set value of type '${typeof value}'.`,
      );
    }
    this.values.set(key, value);
    this.bus.emit('changed', { key, value, previous });
  }

  /** Whether `key` has ever been set. */
  has(key: string): boolean {
    return this.values.has(key);
  }

  /** A fresh plain-object copy of every key/value currently stored. */
  snapshot(): Record<string, WorldValue> {
    return Object.fromEntries(this.values);
  }
}
