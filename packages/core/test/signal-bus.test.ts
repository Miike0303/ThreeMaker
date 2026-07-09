import { describe, expect, it, vi } from 'vitest';
import { SignalBus } from '../src/signal-bus.js';

type TestEvents = {
  ping: { value: number };
  silence: undefined;
};

describe('SignalBus', () => {
  it('invokes listeners subscribed to the emitted event with the payload', () => {
    const bus = new SignalBus<TestEvents>();
    const listener = vi.fn();
    bus.on('ping', listener);

    bus.emit('ping', { value: 42 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ value: 42 });
  });

  it('does not invoke listeners subscribed to a different event', () => {
    const bus = new SignalBus<TestEvents>();
    const pingListener = vi.fn();
    const silenceListener = vi.fn();
    bus.on('ping', pingListener);
    bus.on('silence', silenceListener);

    bus.emit('ping', { value: 1 });

    expect(silenceListener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const bus = new SignalBus<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();
    bus.on('ping', first);
    bus.on('ping', second);

    bus.emit('ping', { value: 7 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener after off() is called', () => {
    const bus = new SignalBus<TestEvents>();
    const listener = vi.fn();
    bus.on('ping', listener);
    bus.off('ping', listener);

    bus.emit('ping', { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying a listener after the unsubscribe function is called', () => {
    const bus = new SignalBus<TestEvents>();
    const listener = vi.fn();
    const unsubscribe = bus.on('ping', listener);
    unsubscribe();

    bus.emit('ping', { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('once() only fires a single time even across multiple emits', () => {
    const bus = new SignalBus<TestEvents>();
    const listener = vi.fn();
    bus.once('ping', listener);

    bus.emit('ping', { value: 1 });
    bus.emit('ping', { value: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ value: 1 });
  });

  it('a listener unsubscribing itself mid-emit does not break remaining listeners', () => {
    const bus = new SignalBus<TestEvents>();
    let unsubscribeSelf: () => void = () => {};
    const self = vi.fn(() => unsubscribeSelf());
    const other = vi.fn();
    unsubscribeSelf = bus.on('ping', self);
    bus.on('ping', other);

    bus.emit('ping', { value: 1 });

    expect(self).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('clear(event) removes only that event listeners', () => {
    const bus = new SignalBus<TestEvents>();
    const pingListener = vi.fn();
    const silenceListener = vi.fn();
    bus.on('ping', pingListener);
    bus.on('silence', silenceListener);

    bus.clear('ping');
    bus.emit('ping', { value: 1 });
    bus.emit('silence', undefined);

    expect(pingListener).not.toHaveBeenCalled();
    expect(silenceListener).toHaveBeenCalledTimes(1);
  });

  it('clear() with no argument removes every listener', () => {
    const bus = new SignalBus<TestEvents>();
    const pingListener = vi.fn();
    bus.on('ping', pingListener);

    bus.clear();
    bus.emit('ping', { value: 1 });

    expect(pingListener).not.toHaveBeenCalled();
  });

  it('listenerCount reflects registrations and removals', () => {
    const bus = new SignalBus<TestEvents>();
    expect(bus.listenerCount('ping')).toBe(0);

    const unsubscribe = bus.on('ping', vi.fn());
    expect(bus.listenerCount('ping')).toBe(1);

    unsubscribe();
    expect(bus.listenerCount('ping')).toBe(0);
  });
});
