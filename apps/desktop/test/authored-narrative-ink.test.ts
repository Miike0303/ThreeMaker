/**
 * Compiles the COMMITTED fixture's real `.ink` sidecars
 * (`test/authored-narrative/`, task 4.8) with the real `compileInk`, and runs
 * the exit-criterion scenario through them on BOTH of the elder's branches.
 *
 * Needed because nothing else in the suite compiles them: `loadAuthoredMap`
 * deliberately stops at reading the sources (compilation belongs to the
 * per-map narrative bundle, design D1/D7), and `compileInk` is otherwise only
 * reached from `main.ts`, which no test exercises. Without this file an ink
 * syntax error in the committed fixture would pass the whole suite green and
 * surface only at runtime.
 *
 * Pattern: `packages/narrative/test/exit-criterion.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EventCommand, type EventHost, EventInterpreter, WorldState } from '@threemaker/core';
import { bindStoryToWorld, compileInk, InkDialogueProvider } from '@threemaker/narrative';
import { describe, expect, it } from 'vitest';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-narrative');

/** Discovered rather than listed, so a sidecar added to the fixture cannot skip compilation; the count is asserted below so a DELETED one cannot pass either. */
const SIDECAR_NAMES = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.ink'))
  .sort();

function fixtureInk(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const noopHost: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: () => {
    /* not exercised by this scenario */
  },
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

const ELDER_SCRIPT: readonly EventCommand[] = [
  { type: 'showDialogue', source: { kind: 'ink', storyId: 'elder', knot: 'start' } },
];
const GUARD_SCRIPT: readonly EventCommand[] = [
  { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard', knot: 'start' } },
];

/**
 * Talks to the elder, takes `choiceIndex` (0 = "Tell me the secret", 1 = "Not
 * now"), then talks to the guard -- the fixture's whole authored point, run
 * through the same real `EventInterpreter`/`InkDialogueProvider` the desktop
 * uses.
 */
function runFixtureScenario(choiceIndex: number): {
  readonly secretRevealed: unknown;
  readonly guardLine: string | undefined;
} {
  const world = new WorldState();
  world.set('secret_revealed', false);

  const stories = new Map<string, ReturnType<typeof compileInk>>();
  for (const storyId of ['elder', 'guard']) {
    const story = compileInk(fixtureInk(`current.${storyId}.ink`));
    bindStoryToWorld(story, { storyId, world });
    stories.set(storyId, story);
  }

  const interpreter = new EventInterpreter({
    world,
    host: noopHost,
    provider: new InkDialogueProvider(stories),
  });
  const lines: string[] = [];
  interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));

  interpreter.run(ELDER_SCRIPT);
  interpreter.advance(); // the elder's opening line -> choices
  interpreter.choose(choiceIndex);
  interpreter.advance(); // consume the chosen branch's line, script finishes

  interpreter.run(GUARD_SCRIPT);
  interpreter.advance();

  return { secretRevealed: world.get('secret_revealed'), guardLine: lines.at(-1) };
}

describe('committed authored-narrative fixture -- real ink compilation', () => {
  it('compiles every sidecar the fixture ships', () => {
    expect(SIDECAR_NAMES).toEqual([
      'current.elder.ink',
      'current.guard.ink',
      'current.welcome.ink',
    ]);
    for (const name of SIDECAR_NAMES) {
      expect(() => compileInk(fixtureInk(name))).not.toThrow();
    }
  });

  it('"Tell me the secret" sets the world variable and the guard takes the revealed branch', () => {
    const { secretRevealed, guardLine } = runFixtureScenario(0);

    expect(secretRevealed).toBe(true);
    expect(guardLine).toBe('Ah, so the elder told you about the passage. Move along.');
  });

  it('"Not now" leaves the world variable alone and the guard takes the challenge branch', () => {
    const { secretRevealed, guardLine } = runFixtureScenario(1);

    expect(secretRevealed).toBe(false);
    expect(guardLine).toBe('Halt! State your business.');
  });
});
