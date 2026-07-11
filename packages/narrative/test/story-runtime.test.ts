import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldState } from '@threemaker/core';
import { describe, expect, it } from 'vitest';
import { compileInk } from '../src/compile.js';
import { bindStoryToWorld } from '../src/story-runtime.js';

const inkFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ink');
const worldBridgeSource = readFileSync(path.join(inkFixturesDir, 'world-bridge.ink'), 'utf-8');
const unseededGetSource = readFileSync(path.join(inkFixturesDir, 'unseeded-get.ink'), 'utf-8');

function runToEnd(story: ReturnType<typeof compileInk>): string {
  let output = '';
  while (story.canContinue) {
    output += story.Continue();
  }
  return output;
}

describe('bindStoryToWorld', () => {
  it('roundtrips values through world_get/world_set externals over a real compiled story', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(worldBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world });
    const output = runToEnd(story);

    expect(output).toContain('The world says: sunny');
    expect(world.get('greeting_seen')).toBe(true);
  });

  it('mirrors an observed ink variable into world-state at key ink.{storyId}.{var}', () => {
    const world = new WorldState();
    world.set('weather', 'sunny');
    const story = compileInk(worldBridgeSource);

    bindStoryToWorld(story, { storyId: 'demo', world, observedVariables: ['mood'] });
    runToEnd(story);

    expect(world.get('ink.demo.mood')).toBe('happy');
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
});
