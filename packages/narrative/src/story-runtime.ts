import type { WorldState, WorldValue } from '@threemaker/core';
import type { Story } from 'inkjs';

function isWorldValue(value: unknown): value is WorldValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

/**
 * Structural inventory surface for the `item_count` / `item_add` ink externals (mirrors
 * core's ItemStore / gameplay's Inventory without importing either package).
 */
export type StoryItemStore = {
  count(id: string): number;
  add?(id: string, delta: number): number;
};

/**
 * Structural stat surface for the `stat_get` / `stat_modify` ink externals
 * (mirrors core's StatStore / gameplay's StatBlock without importing either package).
 */
export type StoryStatStore = {
  get(id: string): number;
  modify?(id: string, delta: number): number;
};

/** Options for {@link bindStoryToWorld}. */
export type BindStoryToWorldOptions = {
  /**
   * Identifies this story instance for the observer mirror key namespace
   * (`ink.{storyId}.{var}`). This string is independent from whatever key
   * the same story is registered under in an {@link InkStoryRegistry}
   * (`ink-dialogue-provider.ts`) — a mismatch between the two doesn't
   * error, it silently mis-namespaces the mirror keys. Keep them identical
   * by convention (register the story and call `bindStoryToWorld` with the
   * same id).
   */
  readonly storyId: string;
  /** The shared world-state this story's externals read from and write to. */
  readonly world: WorldState;
  /**
   * Names of ink global `VAR`s to mirror one-way into world-state whenever
   * the story changes them, under key `ink.{storyId}.{name}`. Each name
   * must be declared as a global variable in the ink source, or inkjs's
   * `ObserveVariable` throws. Omit for stories that only use the
   * `world_get`/`world_set` externals.
   */
  readonly observedVariables?: readonly string[];
  /**
   * Optional inventory for `item_count` / `item_add`. When omitted and a
   * story calls either, binding still installs the external but throws
   * a precise error (same fail-loud style as unseeded `world_get`) — never
   * a silent 0. `item_add` requires the store's optional `add` method.
   */
  readonly items?: StoryItemStore;
  /**
   * Optional stats for `EXTERNAL stat_get(statId)` / `stat_modify(statId, delta)`.
   * When omitted and a story calls either, throws a precise error rather than a silent 0.
   */
  readonly stats?: StoryStatStore;
};

/**
 * Binds `story`'s `world_get`/`world_set` external functions to `world`,
 * optionally `item_count`/`item_add`/`stat_get`/`stat_modify` to inventory/stat stores, and
 * optionally mirrors declared ink variables into world-state as they change.
 *
 * `story`'s ink source must declare the world externals it uses:
 * ```
 * EXTERNAL world_get(key)
 * EXTERNAL world_set(key, value)
 * EXTERNAL item_count(itemId)
 * EXTERNAL item_add(itemId, delta)
 * EXTERNAL stat_get(statId)
 * EXTERNAL stat_modify(statId, delta)
 * ```
 * Alternatively, declare `EXTERNAL world_get(key, fallback)` to supply a fallback.
 * One-argument `world_get` reads `world.get(key)` and throws if `key` was never set —
 * inkjs converts a bound external function's `undefined` return into ink
 * Void, and any comparison against Void (e.g. `{world_get("x") == true: ...}`)
 * throws an opaque, hard-to-diagnose inkjs `StoryException`. Requiring the
 * key to be seeded first fails loudly with a precise message instead, the
 * same "fail loudly on content bugs" philosophy as `WorldState.set`'s type
 * lock. The two-argument `world_get(key, fallback)` returns the fallback when
 * the key is unset without writing it; existing values, including falsy ones, win.
 * `world_set` calls `world.set(key, value)`. Both directions are
 * externals-driven (ink pulls/pushes) — the optional observer mirror is a
 * SEPARATE, one-way channel (ink var change -> world-state key), never the
 * reverse, so there's no sync loop between the two mechanisms.
 *
 * `item_count` / `stat_get` always bind so a missing store fails with a
 * precise message rather than inkjs's opaque unbound-external error or a
 * silent 0. When the store is present they delegate to `count` / `get`.
 * `item_add` also always binds, delegates to `add`, and returns the new count.
 * A missing or read-only (count-only) items store fails with a precise message.
 * It is bound non-lookahead-safe because it mutates inventory; speculative
 * lookahead must not grant or consume an item twice.
 * `stat_modify` also always binds, delegates to `modify`, and returns the new
 * stat value. A missing or read-only (get-only) stats store fails with a precise
 * message. It is bound non-lookahead-safe because it mutates stats; speculative
 * lookahead must not apply a modification twice.
 *
 * Mirrored variable values must be a {@link WorldValue} (boolean, number, or
 * string); a variable that becomes a non-primitive ink value (e.g. a `LIST`)
 * throws, since `WorldState` cannot represent it — same "fail loudly on
 * content bugs" philosophy as `WorldState.set`'s type lock.
 *
 * Call this exactly once per `Story` instance, before its first `Continue()`
 * — rebinding an already-bound external function throws inkjs's own
 * internal assertion.
 */
export function bindStoryToWorld(story: Story, options: BindStoryToWorldOptions): void {
  const { storyId, world, observedVariables = [], items, stats } = options;

  // The rest tuple keeps arity at 1 for inkjs's args.length >= func.length check.
  story.BindExternalFunction(
    'world_get',
    (key: string, ...[fallback]: [fallback?: WorldValue]) => {
      if (world.has(key)) {
        return world.get(key);
      }
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(
        `story-runtime: world_get("${key}") read a key that was never set — seed it in WorldState before running the story.`,
      );
    },
    true,
  );
  story.BindExternalFunction(
    'world_set',
    (key: string, value: WorldValue) => {
      world.set(key, value);
    },
    false,
  );

  story.BindExternalFunction(
    'item_count',
    (itemId: string) => {
      if (!items) {
        throw new Error(
          `story-runtime: item_count("${itemId}") called but no items store was bound — pass items when binding the story.`,
        );
      }
      return items.count(itemId);
    },
    true,
  );
  story.BindExternalFunction(
    'item_add',
    (itemId: string, delta: number) => {
      if (!items) {
        throw new Error(
          `story-runtime: item_add("${itemId}") called but no items store was bound — pass items when binding the story.`,
        );
      }
      if (!items.add) {
        throw new Error(
          `story-runtime: item_add("${itemId}") called but the bound items store is read-only (count-only) — provide an items store with an add method when binding the story.`,
        );
      }
      return items.add(itemId, delta);
    },
    false,
  );
  story.BindExternalFunction(
    'stat_get',
    (statId: string) => {
      if (!stats) {
        throw new Error(
          `story-runtime: stat_get("${statId}") called but no stats store was bound — pass stats when binding the story.`,
        );
      }
      return stats.get(statId);
    },
    true,
  );
  story.BindExternalFunction(
    'stat_modify',
    (statId: string, delta: number) => {
      if (!stats) {
        throw new Error(
          `story-runtime: stat_modify("${statId}") called but no stats store was bound — pass stats when binding the story.`,
        );
      }
      if (!stats.modify) {
        throw new Error(
          `story-runtime: stat_modify("${statId}") called but the bound stats store is read-only (get-only) — provide a stats store with a modify method when binding the story.`,
        );
      }
      return stats.modify(statId, delta);
    },
    false,
  );

  for (const variableName of observedVariables) {
    story.ObserveVariable(variableName, (name: string, newValue: unknown) => {
      if (!isWorldValue(newValue)) {
        throw new Error(
          `story-runtime: observed ink variable "${name}" changed to a non-primitive value (${typeof newValue}); only boolean/number/string ink variables can mirror into world-state.`,
        );
      }
      world.set(`ink.${storyId}.${name}`, newValue);
    });
  }
}
