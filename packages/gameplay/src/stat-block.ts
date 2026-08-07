/**
 * Session stat store (PLAN_DEV_2 C4).
 *
 * Built from {@link StatDefinition} entries; values clamp into each def's
 * `[min, max]`. Same silent-`replaceAll` contract as inventory/world-state
 * for save-load rehydrate.
 */

import type { StatDefinition } from './game-defs.js';
import { SignalBus, type SignalSubscriber } from './signal-bus.js';

export type StatBlockEvents = {
  changed: { statId: string; value: number; previous: number };
};

type InternalStat = {
  readonly def: StatDefinition;
  value: number;
};

export class StatBlock {
  /**
   * Subscribe to stat changes. `changed` fires only when a `set`/`modify`
   * changes the clamped value — never from `replaceAll`.
   */
  readonly signals: SignalSubscriber<StatBlockEvents>;

  private readonly bus = new SignalBus<StatBlockEvents>();
  private readonly stats = new Map<string, InternalStat>();
  private readonly defs: readonly StatDefinition[];

  constructor(definitions: readonly StatDefinition[]) {
    // Defensive copies so later mutation of the caller's objects cannot
    // change clamping or what `definitions()` reports.
    const copies = definitions.map((d) => ({ ...d }));
    const seen = new Map<string, number>();
    for (const [index, def] of copies.entries()) {
      const prior = seen.get(def.id);
      if (prior !== undefined) {
        throw new Error(
          `StatBlock: duplicate stat id ${JSON.stringify(def.id)} at indexes ${prior} and ${index}.`,
        );
      }
      seen.set(def.id, index);
      this.stats.set(def.id, { def, value: def.base });
    }
    this.defs = copies;
    this.signals = this.bus;
  }

  /** Current value for `statId`. Throws on unknown id. */
  get(statId: string): number {
    return this.require(statId).value;
  }

  /**
   * Set `statId` to `value`, clamped into `[min, max]`. Throws on unknown id
   * or non-finite value. Emits `changed` only when the clamped result differs
   * from the previous value. Returns the clamped value.
   */
  set(statId: string, value: number): number {
    if (!Number.isFinite(value)) {
      throw new Error(`StatBlock.set: value must be finite, got ${String(value)}.`);
    }
    const entry = this.require(statId);
    const previous = entry.value;
    const next = clamp(value, entry.def.min, entry.def.max);
    if (next === previous) {
      return next;
    }
    entry.value = next;
    this.bus.emit('changed', { statId, value: next, previous });
    return next;
  }

  /** `set(statId, get(statId) + delta)`. */
  modify(statId: string, delta: number): number {
    return this.set(statId, this.get(statId) + delta);
  }

  /** Fresh plain-object copy of every current stat value. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, entry] of this.stats) {
      out[id] = entry.value;
    }
    return out;
  }

  /**
   * Replace values from `values` (save-load rehydrate). Silent — no signals.
   * Unknown keys throw. Values are clamped into range. Stats missing from
   * the record reset to `base`.
   */
  replaceAll(values: Readonly<Record<string, number>>): void {
    // Validate everything first so a corrupt payload never half-mutates.
    for (const [statId, raw] of Object.entries(values)) {
      if (!this.stats.has(statId)) {
        throw new Error(`StatBlock.replaceAll: unknown stat id ${JSON.stringify(statId)}.`);
      }
      if (!Number.isFinite(raw)) {
        throw new Error(
          `StatBlock.replaceAll: value for ${JSON.stringify(statId)} must be finite, got ${String(raw)}.`,
        );
      }
    }
    for (const [statId, entry] of this.stats) {
      if (Object.hasOwn(values, statId)) {
        const raw = values[statId] as number;
        entry.value = clamp(raw, entry.def.min, entry.def.max);
      } else {
        entry.value = entry.def.base;
      }
    }
  }

  /** The definitions this block was built with (readonly). */
  definitions(): readonly StatDefinition[] {
    return this.defs;
  }

  private require(statId: string): InternalStat {
    const entry = this.stats.get(statId);
    if (entry === undefined) {
      throw new Error(`StatBlock: unknown stat id ${JSON.stringify(statId)}.`);
    }
    return entry;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
