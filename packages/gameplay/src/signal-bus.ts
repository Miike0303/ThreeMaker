/**
 * Minimal typed pub/sub bus (same shape as `@threemaker/core` SignalBus).
 * Local copy so `@threemaker/gameplay` stays free of a core dependency.
 */

export type Listener<TPayload> = (payload: TPayload) => void;

export type Unsubscribe = () => void;

/** Read-only subscription surface — no `emit` for consumers. */
export type SignalSubscriber<TEventMap extends Record<string, unknown>> = Pick<
  SignalBus<TEventMap>,
  'on' | 'off' | 'once'
>;

export class SignalBus<TEventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEventMap, Set<Listener<never>>>();

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

  off<TEvent extends keyof TEventMap>(event: TEvent, listener: Listener<TEventMap[TEvent]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<TEvent extends keyof TEventMap>(event: TEvent, payload: TEventMap[TEvent]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      (listener as Listener<TEventMap[TEvent]>)(payload);
    }
  }
}
