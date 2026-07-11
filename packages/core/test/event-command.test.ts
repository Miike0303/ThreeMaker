import { describe, expect, it } from 'vitest';
import { parseEventScript } from '../src/event-command.js';

describe('parseEventScript', () => {
  it('parses a valid v1 script with every command type', () => {
    const json = {
      version: 1,
      events: {
        intro: [
          { type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 2 },
          {
            type: 'showDialogue',
            speaker: 'Elder',
            source: { kind: 'text', lines: ['Hello there.'] },
          },
          {
            type: 'conditional',
            if: { key: 'metElder', op: 'eq', value: true },
            then: [{ type: 'setWorldVar', key: 'gold', value: 10 }],
            else: [{ type: 'teleport', entityId: 'hero', x: 3, y: 4, facing: 'down' }],
          },
        ],
        guard: [
          {
            type: 'showDialogue',
            source: { kind: 'ink', storyId: 'guard', knot: 'greeting' },
          },
        ],
      },
    };

    const result = parseEventScript(json);

    expect(result).toEqual(json.events);
  });

  it('parses a script with no events', () => {
    expect(parseEventScript({ version: 1, events: {} })).toEqual({});
  });

  it('throws on a non-object root', () => {
    expect(() => parseEventScript('not an object')).toThrow(
      'Invalid Event Script: expected an object, got string.',
    );
  });

  it('throws on a null root', () => {
    expect(() => parseEventScript(null)).toThrow(
      'Invalid Event Script: expected an object, got object.',
    );
  });

  it('throws when "version" is not 1', () => {
    expect(() => parseEventScript({ version: 2, events: {} })).toThrow(
      'Invalid Event Script: "version" must be 1, got 2.',
    );
  });

  it('throws when "events" is missing', () => {
    expect(() => parseEventScript({ version: 1 })).toThrow(
      'Invalid Event Script: "events" must be an object.',
    );
  });

  it('throws when an event entry is not an array', () => {
    expect(() => parseEventScript({ version: 1, events: { intro: {} } })).toThrow(
      'Invalid Event Script: events.intro must be an array of commands.',
    );
  });

  it('throws on an unknown command type', () => {
    expect(() => parseEventScript({ version: 1, events: { intro: [{ type: 'attack' }] } })).toThrow(
      'Invalid Event Script: events.intro[0] has unknown command type "attack".',
    );
  });

  it('throws when a command is missing "type"', () => {
    expect(() =>
      parseEventScript({ version: 1, events: { intro: [{ entityId: 'hero' }] } }),
    ).toThrow('Invalid Event Script: events.intro[0] is missing a string "type".');
  });

  it('throws on moveEntity missing "entityId"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'moveEntity', direction: 'up', steps: 1 }] },
      }),
    ).toThrow('Invalid Event Script: events.intro[0] (moveEntity) requires a string "entityId".');
  });

  it('throws on moveEntity with an invalid "direction"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'moveEntity', entityId: 'hero', direction: 'north', steps: 1 }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (moveEntity) "direction" must be one of down, left, right, up, got "north".',
    );
  });

  it('throws on moveEntity with a non-number "steps"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: '2' }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (moveEntity) "steps" must be an integer >= 1, got "2".',
    );
  });

  it('throws on moveEntity with a "steps" of 0', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 0 }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (moveEntity) "steps" must be an integer >= 1, got 0.',
    );
  });

  it('throws on moveEntity with a negative "steps"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: -1 }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (moveEntity) "steps" must be an integer >= 1, got -1.',
    );
  });

  it('throws on moveEntity with a fractional "steps"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'moveEntity', entityId: 'hero', direction: 'up', steps: 1.5 }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (moveEntity) "steps" must be an integer >= 1, got 1.5.',
    );
  });

  it('throws on showDialogue missing "source"', () => {
    expect(() =>
      parseEventScript({ version: 1, events: { intro: [{ type: 'showDialogue' }] } }),
    ).toThrow('Invalid Event Script: events.intro[0] (showDialogue) requires a "source" object.');
  });

  it('throws on showDialogue with an unknown source "kind"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'showDialogue', source: { kind: 'audio' } }] },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (showDialogue) source has unknown "kind" "audio".',
    );
  });

  it('throws on a text source missing "lines"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'showDialogue', source: { kind: 'text' } }] },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (showDialogue) text source requires an array "lines".',
    );
  });

  it('throws on an ink source missing "storyId"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'showDialogue', source: { kind: 'ink' } }] },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (showDialogue) ink source requires a string "storyId".',
    );
  });

  it('throws on conditional missing "if"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'conditional', then: [] }] },
      }),
    ).toThrow('Invalid Event Script: events.intro[0] (conditional) requires an "if" object.');
  });

  it('throws on conditional with an invalid "op"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [
            {
              type: 'conditional',
              if: { key: 'gold', op: 'greater-than', value: 5 },
              then: [],
            },
          ],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (conditional) "if.op" must be one of eq, neq, lt, lte, gt, gte, got "greater-than".',
    );
  });

  it('throws on conditional missing "then"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'conditional', if: { key: 'gold', op: 'eq', value: 5 } }],
        },
      }),
    ).toThrow('Invalid Event Script: events.intro[0] (conditional) requires an array "then".');
  });

  it('throws on a malformed command nested inside a conditional "then" branch, labeled with its branch and index', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [
            {
              type: 'conditional',
              if: { key: 'gold', op: 'eq', value: 5 },
              then: [{ type: 'attack' }],
            },
          ],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (conditional).then[0] has unknown command type "attack".',
    );
  });

  it('throws on a malformed command nested inside a conditional "else" branch, labeled with its branch and index', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [
            {
              type: 'conditional',
              if: { key: 'gold', op: 'eq', value: 5 },
              then: [],
              else: [{ type: 'attack' }],
            },
          ],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (conditional).else[0] has unknown command type "attack".',
    );
  });

  it('throws on setWorldVar missing "key"', () => {
    expect(() =>
      parseEventScript({ version: 1, events: { intro: [{ type: 'setWorldVar', value: 1 }] } }),
    ).toThrow('Invalid Event Script: events.intro[0] (setWorldVar) requires a string "key".');
  });

  it('throws on setWorldVar with an invalid "value" type', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'setWorldVar', key: 'gold', value: {} }] },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (setWorldVar) "value" must be a boolean, number, or string.',
    );
  });

  it('throws on teleport missing "x"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { intro: [{ type: 'teleport', entityId: 'hero', y: 2 }] },
      }),
    ).toThrow('Invalid Event Script: events.intro[0] (teleport) requires a number "x".');
  });

  it('throws on teleport with an invalid "facing"', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          intro: [{ type: 'teleport', entityId: 'hero', x: 1, y: 2, facing: 'sideways' }],
        },
      }),
    ).toThrow(
      'Invalid Event Script: events.intro[0] (teleport) "facing" must be one of down, left, right, up, got "sideways".',
    );
  });
});
