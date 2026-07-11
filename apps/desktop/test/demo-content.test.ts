import { describe, expect, it } from 'vitest';
import { assembleDemoContent } from '../src/demo-content.js';

const VALID_NPCS = {
  version: 1,
  npcs: [
    {
      id: 'elder',
      x: 10,
      y: 10,
      facing: 'down',
      sprite: { sheet: 'Actor1', index: 1 },
      onInteract: 'elder_intro',
    },
    {
      id: 'guard',
      x: 8,
      y: 12,
      facing: 'right',
      sprite: { sheet: 'Actor1', index: 2 },
      onInteract: 'guard_check',
    },
  ],
};

const VALID_TRIGGERS = {
  version: 1,
  triggers: [{ id: 'welcome', x: 10, y: 11, on: 'enter', event: 'welcome_message' }],
};

const VALID_EVENTS = {
  version: 1,
  events: {
    welcome_message: [
      { type: 'showDialogue', source: { kind: 'ink', storyId: 'welcome', knot: 'start' } },
    ],
    elder_intro: [
      { type: 'showDialogue', source: { kind: 'ink', storyId: 'elder', knot: 'start' } },
    ],
    guard_check: [
      { type: 'showDialogue', source: { kind: 'ink', storyId: 'guard', knot: 'start' } },
    ],
  },
};

const VALID_INK_MODULES: Record<string, string> = {
  './demo/map007.welcome.ink': '=== start ===\nWelcome. -> END\n',
  './demo/map007.elder.ink':
    'EXTERNAL world_set(key, value)\n=== start ===\n~ world_set("secret_revealed", true)\n-> END\n',
  './demo/map007.guard.ink':
    'EXTERNAL world_get(key)\n=== start ===\n{ world_get("secret_revealed") == true: yes }\n-> END\n',
};

function modules(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    npcsModules: overrides.npcsModules ?? { './demo/map007.npcs.json': { default: VALID_NPCS } },
    triggersModules: overrides.triggersModules ?? {
      './demo/map007.triggers.json': { default: VALID_TRIGGERS },
    },
    eventsModules: overrides.eventsModules ?? {
      './demo/map007.events.json': { default: VALID_EVENTS },
    },
    inkModules: overrides.inkModules ?? VALID_INK_MODULES,
  } as never;
}

const WORLD_SEEDS = new Map([['secret_revealed', false]]);

describe('assembleDemoContent', () => {
  it('assembles valid demo content: parsed npcs/triggers/events plus ink sources keyed by story id', () => {
    const content = assembleDemoContent(modules(), WORLD_SEEDS);

    expect(content.npcs.npcs).toHaveLength(2);
    expect(content.triggers.triggers).toHaveLength(1);
    expect(Object.keys(content.events)).toEqual(['welcome_message', 'elder_intro', 'guard_check']);
    expect([...content.inkSources.keys()].sort()).toEqual(['elder', 'guard', 'welcome']);
    expect(content.worldSeeds.get('secret_revealed')).toBe(false);
  });

  it('fails loudly when an event references a dangling ink storyId', () => {
    const badEvents = {
      version: 1,
      events: {
        ...VALID_EVENTS.events,
        elder_intro: [
          { type: 'showDialogue', source: { kind: 'ink', storyId: 'nonexistent', knot: 'start' } },
        ],
      },
    };

    expect(() =>
      assembleDemoContent(
        modules({ eventsModules: { './demo/map007.events.json': { default: badEvents } } }),
        WORLD_SEEDS,
      ),
    ).toThrow(/elder_intro.*"nonexistent"/);
  });

  it('resolves a dangling ink storyId reference inside a conditional branch too', () => {
    const badEvents = {
      version: 1,
      events: {
        welcome_message: [
          {
            type: 'conditional',
            if: { key: 'flag', op: 'eq', value: true },
            then: [
              {
                type: 'showDialogue',
                source: { kind: 'ink', storyId: 'nonexistent', knot: 'start' },
              },
            ],
          },
        ],
      },
    };

    expect(() =>
      assembleDemoContent(
        modules({ eventsModules: { './demo/map007.events.json': { default: badEvents } } }),
        WORLD_SEEDS,
      ),
    ).toThrow(/nonexistent/);
  });

  it('fails loudly when an NPC references a dangling onInteract event id', () => {
    const badNpcs = {
      version: 1,
      npcs: [{ ...VALID_NPCS.npcs[0], onInteract: 'missing_event' }],
    };

    expect(() =>
      assembleDemoContent(
        modules({ npcsModules: { './demo/map007.npcs.json': { default: badNpcs } } }),
        WORLD_SEEDS,
      ),
    ).toThrow(/elder.*"missing_event"/);
  });

  it('fails loudly when a trigger references a dangling event id', () => {
    const badTriggers = {
      version: 1,
      triggers: [{ id: 'welcome', x: 10, y: 11, on: 'enter', event: 'missing_event' }],
    };

    expect(() =>
      assembleDemoContent(
        modules({ triggersModules: { './demo/map007.triggers.json': { default: badTriggers } } }),
        WORLD_SEEDS,
      ),
    ).toThrow(/welcome.*"missing_event"/);
  });

  it('fails loudly when an ink source uses world_get but no world-seed defaults are declared', () => {
    expect(() => assembleDemoContent(modules(), new Map())).toThrow(/world_get/);
  });

  it('fails loudly when zero or multiple npcs/triggers/events files are found', () => {
    expect(() => assembleDemoContent(modules({ npcsModules: {} }), WORLD_SEEDS)).toThrow(
      /npcs.*file/i,
    );
    expect(() =>
      assembleDemoContent(
        modules({
          npcsModules: {
            './demo/map007.npcs.json': { default: VALID_NPCS },
            './demo/map021.npcs.json': { default: VALID_NPCS },
          },
        }),
        WORLD_SEEDS,
      ),
    ).toThrow(/npcs.*file/i);
  });
});
