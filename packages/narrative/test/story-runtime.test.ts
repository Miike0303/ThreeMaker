import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldState } from '@threemaker/core';
import { describe, expect, it, vi } from 'vitest';
import { compileInk } from '../src/compile.js';
import { bindStoryToWorld } from '../src/story-runtime.js';

const inkFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ink');
const worldBridgeSource = readFileSync(path.join(inkFixturesDir, 'world-bridge.ink'), 'utf-8');
const unseededGetSource = readFileSync(path.join(inkFixturesDir, 'unseeded-get.ink'), 'utf-8');
const itemStatBridgeSource = readFileSync(
  path.join(inkFixturesDir, 'item-stat-bridge.ink'),
  'utf-8',
);
const itemCountOnlySource = readFileSync(path.join(inkFixturesDir, 'item-count-only.ink'), 'utf-8');
const statGetOnlySource = readFileSync(path.join(inkFixturesDir, 'stat-get-only.ink'), 'utf-8');

function runToEnd(story: ReturnType<typeof compileInk>): string {
  let output = '';
  while (story.canContinue) {
    output += story.Continue();
  }
  return output;
}

describe('bindStoryToWorld', () => {
  it('mirrors a numeric Ink variable into world-state', () => {
    const world = new WorldState();
    const story = compileInk('VAR score = 0\n~ score = 7\nDone.\n-> END\n');

    bindStoryToWorld(story, { storyId: 'demo', world, observedVariables: ['score'] });
    runToEnd(story);

    expect(world.get('ink.demo.score')).toBe(7);
  });

  it.each([
    {
      name: 'world_get',
      external: 'world_get',
      declaration: 'EXTERNAL world_get(key)',
      argument: '"gold"',
      label: 'Gold',
      value: '5',
      bindStores: (world: WorldState) => {
        world.set('gold', 5);
        return {};
      },
    },
    {
      name: 'item_count',
      external: 'item_count',
      declaration: 'EXTERNAL item_count(itemId)',
      argument: '"potion"',
      label: 'Potions',
      value: '3',
      bindStores: (_world: WorldState) => ({
        items: { count: (id: string) => (id === 'potion' ? 3 : 0) },
      }),
    },
    {
      name: 'stat_get',
      external: 'stat_get',
      declaration: 'EXTERNAL stat_get(statId)',
      argument: '"hp"',
      label: 'HP',
      value: '7',
      bindStores: (_world: WorldState) => ({
        stats: { get: (id: string) => (id === 'hp' ? 7 : 0) },
      }),
    },
  ])('allows $name in interpolated choice text', ({
    declaration,
    external,
    argument,
    label,
    value,
    bindStores,
  }) => {
    const world = new WorldState();
    const stores = bindStores(world);
    const story = compileInk(`${declaration}
The choices are ready.
* [${label}: {${external}(${argument})}] -> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world, ...stores });

    expect(() => runToEnd(story)).not.toThrow();
    expect(story.currentChoices[0]?.text).toBe(`${label}: ${value}`);
  });

  it('roundtrips values through world_get/world_set externals over a real compiled story', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(worldBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world });
    const output = runToEnd(story);

    expect(output).toContain('The world says: sunny');
    expect(world.get('greeting_seen')).toBe(true);
  });

  it('calls world_set only once when Ink looks ahead across a line', () => {
    const world = new WorldState();
    const set = vi.spyOn(world, 'set');
    const story = compileInk(
      'EXTERNAL world_set(key, value)\nBefore.\n~ world_set("flag", true)\nAfter.\n-> END\n',
    );

    bindStoryToWorld(story, { storyId: 'demo', world });
    runToEnd(story);

    expect(set).toHaveBeenCalledTimes(1);
    expect(world.get('flag')).toBe(true);
  });

  it('mirrors an observed ink variable into world-state at key ink.{storyId}.{var}', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(worldBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world, observedVariables: ['mood'] });
    runToEnd(story);

    expect(world.get('ink.demo.mood')).toBe('happy');
  });

  it('mirrors a boolean Ink variable into world-state', () => {
    const world = new WorldState();
    const story = compileInk('VAR gate = false\n~ gate = true\nDone.\n-> END\n');

    bindStoryToWorld(story, { storyId: 'demo', world, observedVariables: ['gate'] });
    runToEnd(story);

    expect(world.get('ink.demo.gate')).toBe(true);
  });

  it('does not mirror unobserved variables', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(worldBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world });
    runToEnd(story);

    expect(world.has('ink.demo.mood')).toBe(false);
  });

  it("throws a precise error (not inkjs's opaque StoryException) when world_get reads a key that was never set", () => {
    const world = new WorldState();
    const story = compileInk(unseededGetSource);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: world_get("never_set") read a key that was never set — seed it in WorldState before running the story.',
    );
  });

  it('returns a string fallback for an unset world key without writing it', () => {
    const world = new WorldState();
    const story = compileInk(`EXTERNAL world_get(key, fallback)
{world_get("quest_seen", "no")}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(runToEnd(story).trim()).toBe('no');
    expect(world.has('quest_seen')).toBe(false);
  });

  it('returns a false fallback for an unset world key', () => {
    const world = new WorldState();
    const story = compileInk(`EXTERNAL world_get(key, fallback)
{world_get("switch", false)}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(runToEnd(story).trim()).toBe('false');
    expect(world.has('switch')).toBe(false);
  });

  it('returns a present false value instead of the fallback', () => {
    const world = new WorldState();
    world.set('flag', false);
    const story = compileInk(`EXTERNAL world_get(key, fallback)
{world_get("flag", true)}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(runToEnd(story).trim()).toBe('false');
  });

  it('returns a numeric fallback for an unset world key', () => {
    const world = new WorldState();
    const story = compileInk(`EXTERNAL world_get(key, fallback)
{world_get("gold", 5)}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(runToEnd(story).trim()).toBe('5');
  });

  it('binds and reads a seeded world key with the one-argument declaration', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(`EXTERNAL world_get(key)
{world_get("weather")}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(runToEnd(story).trim()).toBe('sunny');
  });

  it('throws when the observed ink variable changes to a non-primitive value (e.g. an ink LIST)', () => {
    const world = new WorldState();
    const source = `
LIST fruits = apple, pear, banana
VAR items = ()
~ items += apple
Done.
-> END
`;
    const story = compileInk(source);

    bindStoryToWorld(story, { storyId: 'demo', world, observedVariables: ['items'] });

    expect(() => runToEnd(story)).toThrow(/non-primitive/);
  });

  // C4: structural ItemStore/StatStore shapes — narrative must not import
  // gameplay/core store classes; only count/get surfaces.
  it('binds item_count and stat_get when items/stats stores are provided', () => {
    const world = new WorldState();
    const items = { count: (id: string) => (id === 'potion' ? 3 : 0) };
    const stats = { get: (id: string) => (id === 'hp' ? 12 : 0) };
    const story = compileInk(itemStatBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world, items, stats });
    const output = runToEnd(story);

    expect(output).toContain('Items: 3');
    expect(output).toContain('HP: 12');
  });

  it('throws a precise error when item_count is called without an items store', () => {
    const world = new WorldState();
    const story = compileInk(itemCountOnlySource);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: item_count("key") called but no items store was bound — pass items when binding the story.',
    );
  });

  it('throws a precise error when stat_get is called without a stats store', () => {
    const world = new WorldState();
    const story = compileInk(statGetOnlySource);

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: stat_get("mp") called but no stats store was bound — pass stats when binding the story.',
    );
  });

  it('adds 2 items then consumes 1 through item_add without repeating mutations during lookahead', () => {
    const world = new WorldState();
    const items = {
      counts: new Map<string, number>(),
      count(id: string): number {
        return this.counts.get(id) ?? 0;
      },
      add(id: string, delta: number): number {
        const count = Math.max(0, this.count(id) + delta);
        this.counts.set(id, count);
        return count;
      },
    };
    const story = compileInk(`EXTERNAL item_add(id, delta)
The elder offers a potion.
~ temp added = item_add("potion", 2)
Added: {added}
~ temp remaining = item_add("potion", -1)
Remaining: {remaining}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world, items });
    const output = runToEnd(story);

    expect(items.count('potion')).toBe(1);
    expect(output).toContain('Added: 2');
    expect(output).toContain('Remaining: 1');
  });

  it('throws a precise error when item_add is called with a read-only items store', () => {
    const world = new WorldState();
    const items = { count: (_id: string) => 0 };
    const story = compileInk(
      'EXTERNAL item_add(id, delta)\n~ item_add("potion", 2)\nDone.\n-> END\n',
    );

    bindStoryToWorld(story, { storyId: 'demo', world, items });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: item_add("potion") called but the bound items store is read-only (count-only) — provide an items store with an add method when binding the story.',
    );
  });

  it('throws a precise error when item_add is called without an items store', () => {
    const world = new WorldState();
    const story = compileInk(
      'EXTERNAL item_add(id, delta)\n~ item_add("potion", 2)\nDone.\n-> END\n',
    );

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: item_add("potion") called but no items store was bound — pass items when binding the story.',
    );
  });

  it('modifies a stat once through stat_modify without repeating mutations during lookahead', () => {
    const world = new WorldState();
    let hp = 10;
    let modifyCalls = 0;
    const stats = {
      get: (id: string) => (id === 'hp' ? hp : 0),
      modify(id: string, delta: number): number {
        modifyCalls += 1;
        if (id === 'hp') hp += delta;
        return hp;
      },
    };
    const story = compileInk(`EXTERNAL stat_modify(statId, delta)
Before.
~ temp r = stat_modify("hp", -3)
After: {r}
-> END
`);

    bindStoryToWorld(story, { storyId: 'demo', world, stats });
    const output = runToEnd(story);

    expect(output).toContain('7');
    expect(hp).toBe(7);
    expect(modifyCalls).toBe(1);
  });

  it('throws a precise error when stat_modify is called with a read-only stats store', () => {
    const world = new WorldState();
    const stats = { get: (_id: string) => 10 };
    const story = compileInk(
      'EXTERNAL stat_modify(statId, delta)\n~ stat_modify("hp", -3)\nDone.\n-> END\n',
    );

    bindStoryToWorld(story, { storyId: 'demo', world, stats });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: stat_modify("hp") called but the bound stats store is read-only (get-only) — provide a stats store with a modify method when binding the story.',
    );
  });

  it('throws a precise error when stat_modify is called without a stats store', () => {
    const world = new WorldState();
    const story = compileInk(
      'EXTERNAL stat_modify(statId, delta)\n~ stat_modify("hp", -3)\nDone.\n-> END\n',
    );

    bindStoryToWorld(story, { storyId: 'demo', world });

    expect(() => runToEnd(story)).toThrow(
      'story-runtime: stat_modify("hp") called but no stats store was bound — pass stats when binding the story.',
    );
  });
});

it('names the observed Ink variable that cannot be mirrored', () => {
  const world = new WorldState();
  const story = compileInk(
    'LIST colors = red, blue\nVAR selected_colors = ()\n~ selected_colors += red\nDone.\n-> END\n',
  );
  bindStoryToWorld(story, {
    storyId: 'palette',
    world,
    observedVariables: ['selected_colors'],
  });

  expect(() => runToEnd(story)).toThrow(
    'story-runtime: observed ink variable "selected_colors" changed to a non-primitive value (object); only boolean/number/string ink variables can mirror into world-state.',
  );
});
