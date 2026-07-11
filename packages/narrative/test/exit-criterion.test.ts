import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EventCommand, type EventHost, EventInterpreter, WorldState } from '@threemaker/core';
import { describe, expect, it } from 'vitest';
import { compileInk } from '../src/compile.js';
import { InkDialogueProvider } from '../src/ink-dialogue-provider.js';
import { bindStoryToWorld } from '../src/story-runtime.js';

const inkFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ink');
const storyASource = readFileSync(path.join(inkFixturesDir, 'exit-a.ink'), 'utf-8');
const storyBSource = readFileSync(path.join(inkFixturesDir, 'exit-b.ink'), 'utf-8');

const noopHost: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: () => {
    /* not exercised by this scenario */
  },
};

/**
 * Cross-Cutting Acceptance Scenario (exit criterion, spec #51): a choice in
 * one NPC's Ink story alters world-state so another NPC's Ink dialogue
 * reflects it — entirely via `.ink` data (`world_set`/`world_get`
 * externals) and core's `EventInterpreter`, no hardcoded engine/demo wiring.
 */
describe('Cross-Cutting Acceptance Scenario: NPC A choice changes NPC B dialogue', () => {
  it("story B's dialogue differs before and after story A's world-altering choice", () => {
    const world = new WorldState();
    world.set('secret_revealed', false);

    const storyA = compileInk(storyASource);
    const storyB = compileInk(storyBSource);
    bindStoryToWorld(storyA, { storyId: 'a', world });
    bindStoryToWorld(storyB, { storyId: 'b', world });

    const provider = new InkDialogueProvider(
      new Map([
        ['a', storyA],
        ['b', storyB],
      ]),
    );
    const interpreter = new EventInterpreter({ world, host: noopHost, provider });

    const lines: string[] = [];
    interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));

    const scriptB: readonly EventCommand[] = [
      { type: 'showDialogue', source: { kind: 'ink', storyId: 'b', knot: 'start' } },
    ];
    const scriptA: readonly EventCommand[] = [
      { type: 'showDialogue', source: { kind: 'ink', storyId: 'a', knot: 'start' } },
    ];

    // 1. Interact with B before A's choice.
    interpreter.run(scriptB);
    interpreter.advance(); // consume B's line, script finishes (no choices)
    const beforeChoice = lines.at(-1);

    // 2. Interact with A and make the world-altering choice.
    interpreter.run(scriptA);
    interpreter.advance(); // "Greetings." -> choices
    interpreter.choose(0); // "Tell them the secret" -> world_set + next line
    interpreter.advance(); // consume "The secret is told." -> script finishes

    expect(world.get('secret_revealed')).toBe(true);

    // 3. Interact with B again after the choice.
    interpreter.run(scriptB);
    interpreter.advance();
    const afterChoice = lines.at(-1);

    expect(beforeChoice).toBe('Nothing to see here.');
    expect(afterChoice).toBe('I already know the secret!');
    expect(afterChoice).not.toBe(beforeChoice);
  });
});
