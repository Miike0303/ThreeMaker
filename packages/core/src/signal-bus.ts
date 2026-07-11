/**
 * Typed publish/subscribe bus.
 *
 * `TEventMap` maps event names to their payload type, e.g.:
 *
 * ```ts
 * type MyEvents = {
 *   'entity:spawned': { id: string };
 *   'entity:destroyed': { id: string };
 * };
 * const bus = new SignalBus<MyEvents>();
 * bus.on('entity:spawned', (payload) => console.log(payload.id));
 * ```
 */
export type Listener<TPayload> = (payload: TPayload) => void;

export type Unsubscribe = () => void;

/**
 * Read-only view of a {@link SignalBus}: subscription methods only, no
 * `emit`. Expose this type on public fields to let consumers listen while
 * keeping emission an internal implementation detail — consumers cannot
 * forge events.
 */
export type SignalSubscriber<TEventMap extends Record<string, unknown>> = Pick<
  SignalBus<TEventMap>,
  'on' | 'off' | 'once'
>;

export class SignalBus<TEventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEventMap, Set<Listener<never>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<TEvent extends keyof TEventMap>(
    event: TEvent,
    listener: Listener<TEventMap[TEvent]>,
  ): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  /** Subscribe to an event for a single emission, then auto-unsubscribe. */
  once<TEvent extends keyof TEventMap>(
    event: TEvent,
    listener: Listener<TEventMap[TEvent]>,
  ): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  /** Remove a previously registered listener. */
  off<TEvent extends keyof TEventMap>(event: TEvent, listener: Listener<TEventMap[TEvent]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  /** Synchronously notify all listeners registered for `event`. */
  emit<TEvent extends keyof TEventMap>(event: TEvent, payload: TEventMap[TEvent]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Copy before iterating: a listener may unsubscribe itself or others mid-emit.
    for (const listener of [...set]) {
      (listener as Listener<TEventMap[TEvent]>)(payload);
    }
  }

  /** Remove every listener for a given event, or every listener entirely. */
  clear<TEvent extends keyof TEventMap>(event?: TEvent): void {
    if (event === undefined) {
      this.listeners.clear();
      return;
    }
    this.listeners.delete(event);
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount<TEvent extends keyof TEventMap>(event: TEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
