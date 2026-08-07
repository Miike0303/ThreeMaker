/**
 * Session inventory store (PLAN_DEV_2 C4).
 *
 * Same signal idiom as `WorldState` in `@threemaker/core`: subscription-only
 * `signals`, silent `replaceAll` for save-load rehydrate.
 *
 * Does NOT validate item ids against a catalog — that cross-check belongs
 * to the desktop loader in a later work unit.
 */

import { SignalBus, type SignalSubscriber } from './signal-bus.js';

export type InventoryEvents = {
  changed: { itemId: string; count: number; previous: number };
};

function assertIntegerDelta(delta: number): void {
  if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
    throw new Error(`Inventory.add: delta must be a finite integer, got ${String(delta)}.`);
  }
}

function assertNonNegativeIntegerCount(itemId: string, count: number): void {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
    throw new Error(
      `Inventory.replaceAll: count for ${JSON.stringify(itemId)} must be a non-negative integer, got ${String(count)}.`,
    );
  }
}

export class Inventory {
  /**
   * Subscribe to inventory changes. `changed` fires only when a successful
   * `add()` changes the count — never when the clamped result equals the
   * previous count, from `replaceAll`, or from a failed add.
   */
  readonly signals: SignalSubscriber<InventoryEvents>;

  private readonly bus = new SignalBus<InventoryEvents>();
  private readonly counts = new Map<string, number>();

  constructor() {
    this.signals = this.bus;
  }

  /** Current count for `itemId`, or `0` when absent. */
  count(itemId: string): number {
    return this.counts.get(itemId) ?? 0;
  }

  /**
   * Apply an integer `delta` to `itemId`. Result is clamped at 0 (never
   * negative). Zero counts are removed. Returns the new count.
   * No signal when the clamped result equals the previous count
   * (`delta === 0`, or a negative add that stays at 0).
   */
  add(itemId: string, delta: number): number {
    assertIntegerDelta(delta);
    if (delta === 0) {
      return this.count(itemId);
    }

    const previous = this.count(itemId);
    const next = Math.max(0, previous + delta);
    if (next === previous) {
      return next;
    }
    if (next === 0) {
      this.counts.delete(itemId);
    } else {
      this.counts.set(itemId, next);
    }
    this.bus.emit('changed', { itemId, count: next, previous });
    return next;
  }

  /** Whether `itemId` has a positive count. */
  has(itemId: string): boolean {
    return this.count(itemId) > 0;
  }

  /** Fresh plain-object copy of every positive count. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  /**
   * Replace every count with `counts` (save-load rehydrate).
   * Silent — does not emit `changed`. Drops zeros. Throws naming the bad key
   * when a value is not a non-negative integer.
   */
  replaceAll(counts: Readonly<Record<string, number>>): void {
    for (const [itemId, count] of Object.entries(counts)) {
      assertNonNegativeIntegerCount(itemId, count);
    }
    this.counts.clear();
    for (const [itemId, count] of Object.entries(counts)) {
      if (count > 0) {
        this.counts.set(itemId, count);
      }
    }
  }
}
