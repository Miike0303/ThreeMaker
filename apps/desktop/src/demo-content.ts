import type { EventCommand, EventScript, WorldValue } from '@threemaker/core';
import { parseEventScript } from '@threemaker/core';
import type { NpcFile, TriggerFile } from '@threemaker/gameplay';
import { parseNpcs, parseTriggers } from '@threemaker/gameplay';

/**
 * One map's worth of demo content, assembled and cross-validated. Everything
 * needed to wire `EventInterpreter` + `InkDialogueProvider` + `NpcRegistry` +
 * `TriggerIndex` for the demo map (see design's Cross-Cutting Acceptance
 * Scenario / main.ts wiring).
 */
export interface DemoContent {
  readonly npcs: NpcFile;
  readonly triggers: TriggerFile;
  readonly events: EventScript;
  /** Raw `.ink` source per story id (the segment before the trailing `.ink`, e.g. `map007.elder.ink` -> `elder`). */
  readonly inkSources: ReadonlyMap<string, string>;
  /**
   * World-state defaults to `set()` before running any of this content's
   * events -- every key an `.ink` source reads via `world_get` must be
   * seeded here, or the bridge throws (see `story-runtime.ts`'s
   * fail-loudly-on-unset-key contract).
   */
  readonly worldSeeds: ReadonlyMap<string, WorldValue>;
}

/**
 * Raw glob inputs `assembleDemoContent` validates and assembles -- mirrors
 * main.ts's locale-loading split (`localesFromModules` is pure; only the
 * `import.meta.glob` call itself is untested wiring). Shaped to match
 * Vite's `import.meta.glob(pattern, { eager: true })` output directly (a
 * `path -> { default: T }` record) for JSON, and
 * `import.meta.glob(pattern, { eager: true, query: '?raw', import: 'default' })`
 * (a `path -> string` record) for `.ink` sources.
 */
export interface DemoContentModules {
  readonly npcsModules: Record<string, { default: unknown }>;
  readonly triggersModules: Record<string, { default: unknown }>;
  readonly eventsModules: Record<string, { default: unknown }>;
  readonly inkModules: Record<string, string>;
}

function fail(message: string): never {
  throw new Error(`Invalid demo content: ${message}`);
}

/** Extracts the single value out of a glob-produced record, failing loudly unless exactly one file matched. */
function singleModule<T>(modules: Record<string, { default: T }>, kind: string): T {
  const entries = Object.entries(modules);
  if (entries.length !== 1) {
    fail(
      `expected exactly one ${kind} file under apps/desktop/src/demo/, found ${entries.length} (${entries
        .map(([path]) => path)
        .join(', ')}).`,
    );
  }
  const [, module] = entries[0] as [string, { default: T }];
  return module.default;
}

/** Story id from an `.ink` module path, e.g. `./demo/map007.elder.ink` -> `elder`. */
function storyIdFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const segments = fileName.split('.');
  const storyId = segments.at(-2);
  if (!storyId) {
    fail(
      `could not derive a story id from ink source path "${path}" (expected "<map>.<storyId>.ink").`,
    );
  }
  return storyId;
}

/** Recursively collects every `showDialogue` command's `source`, including branches nested inside `conditional` commands. */
function collectDialogueSources(commands: readonly EventCommand[]): EventCommand[] {
  const result: EventCommand[] = [];
  for (const command of commands) {
    if (command.type === 'showDialogue') {
      result.push(command);
    } else if (command.type === 'conditional') {
      result.push(...collectDialogueSources(command.then));
      if (command.else) result.push(...collectDialogueSources(command.else));
    }
  }
  return result;
}

/**
 * Assembles and cross-validates one map's demo content: parses the raw
 * npcs/triggers/events JSON (defensive, per `@threemaker/gameplay`'s and
 * `@threemaker/core`'s own parsers), keys every `.ink` source by story id,
 * and fails loudly on any dangling reference:
 *
 * - every `showDialogue` command's `ink` `storyId` (including inside
 *   `conditional` branches) must have a matching `.ink` source;
 * - every NPC's `onInteract` and every trigger's `event` must name a real
 *   event id;
 * - if any `.ink` source text calls `world_get(`, `worldSeeds` must be
 *   non-empty (the exact keys aren't parsed out of the ink source -- that
 *   would require compiling it -- this is the simplest honest check that a
 *   story author didn't forget to seed *anything*; the per-key guard is
 *   `story-runtime.ts`'s own `world_get` runtime check).
 */
export function assembleDemoContent(
  modules: DemoContentModules,
  worldSeeds: ReadonlyMap<string, WorldValue>,
): DemoContent {
  const npcs = parseNpcs(singleModule(modules.npcsModules, 'npcs.json'));
  const triggers = parseTriggers(singleModule(modules.triggersModules, 'triggers.json'));
  const events = parseEventScript(singleModule(modules.eventsModules, 'events.json'));

  const inkSources = new Map<string, string>(
    Object.entries(modules.inkModules).map(([path, source]) => [storyIdFromPath(path), source]),
  );

  for (const [eventId, commands] of Object.entries(events)) {
    for (const command of collectDialogueSources(commands)) {
      if (command.type !== 'showDialogue' || command.source.kind !== 'ink') continue;
      const { storyId } = command.source;
      if (!inkSources.has(storyId)) {
        fail(
          `event "${eventId}" references ink storyId "${storyId}", but no such .ink source was loaded.`,
        );
      }
    }
  }

  for (const npc of npcs.npcs) {
    if (!(npc.onInteract in events)) {
      fail(
        `npc "${npc.id}" references onInteract event "${npc.onInteract}", but no such event exists.`,
      );
    }
  }

  for (const trigger of triggers.triggers) {
    if (!(trigger.event in events)) {
      fail(
        `trigger "${trigger.id}" references event "${trigger.event}", but no such event exists.`,
      );
    }
  }

  const usesWorldGet = [...inkSources.values()].some((source) => source.includes('world_get('));
  if (usesWorldGet && worldSeeds.size === 0) {
    fail(
      'one or more .ink sources call world_get(...), but no world-seed defaults were declared -- seed every key those stories read before running them.',
    );
  }

  return { npcs, triggers, events, inkSources, worldSeeds };
}

/**
 * World-state defaults every demo script assumes are seeded before any
 * event runs. Only `secret_revealed` today: `map007.guard.ink` is the only
 * demo story that reads a `world_get` key (set by `map007.elder.ink`'s
 * choice) -- see the Cross-Cutting Acceptance Scenario.
 */
export const DEMO_WORLD_SEEDS: ReadonlyMap<string, WorldValue> = new Map([
  ['secret_revealed', false],
]);

/**
 * Loads and assembles the map007 demo bundle via `import.meta.glob` --
 * mirrors main.ts's `localeModules`/`localesFromModules` split (this thin
 * wrapper is the untested Vite-specific half; `assembleDemoContent` above
 * carries the tested cross-validation logic).
 */
export function loadDemoContent(): DemoContent {
  const npcsModules = import.meta.glob('./demo/*.npcs.json', { eager: true }) as Record<
    string,
    { default: unknown }
  >;
  const triggersModules = import.meta.glob('./demo/*.triggers.json', { eager: true }) as Record<
    string,
    { default: unknown }
  >;
  const eventsModules = import.meta.glob('./demo/*.events.json', { eager: true }) as Record<
    string,
    { default: unknown }
  >;
  const inkModules = import.meta.glob('./demo/*.ink', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  return assembleDemoContent(
    { npcsModules, triggersModules, eventsModules, inkModules },
    DEMO_WORLD_SEEDS,
  );
}
