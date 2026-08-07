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
          {
            type: 'transferMap',
            mapFile: 'map-b.tmmap.json',
            x: 2,
            y: 3,
            facing: 'up',
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

  it('parses transferMap without optional facing', () => {
    const result = parseEventScript({
      version: 1,
      events: {
        door: [{ type: 'transferMap', mapFile: 'other.tmmap.json', x: 0, y: 1 }],
      },
    });
    expect(result.door).toEqual([{ type: 'transferMap', mapFile: 'other.tmmap.json', x: 0, y: 1 }]);
  });

  it('rejects transferMap with empty mapFile', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { door: [{ type: 'transferMap', mapFile: '', x: 0, y: 0 }] },
      }),
    ).toThrow(/mapFile/);
  });

  it('rejects transferMap with non-integer tile coords', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { door: [{ type: 'transferMap', mapFile: 'a.tmmap.json', x: 1.5, y: 0 }] },
      }),
    ).toThrow(/"x"/);
  });

  it('rejects transferMap with negative tile coords', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: { door: [{ type: 'transferMap', mapFile: 'a.tmmap.json', x: -1, y: 0 }] },
      }),
    ).toThrow(/"x"/);
    expect(() =>
      parseEventScript({
        version: 1,
        events: { door: [{ type: 'transferMap', mapFile: 'a.tmmap.json', x: 0, y: -2 }] },
      }),
    ).toThrow(/"y"/);
  });

  it('rejects transferMap mapFile with path traversal segments', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          door: [{ type: 'transferMap', mapFile: '../secrets/map.tmmap.json', x: 0, y: 0 }],
        },
      }),
    ).toThrow(/mapFile/);
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          door: [{ type: 'transferMap', mapFile: 'town/../../other.tmmap.json', x: 0, y: 0 }],
        },
      }),
    ).toThrow(/mapFile/);
  });

  it('rejects transferMap mapFile that is absolute (not a manifest-relative entry)', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          door: [{ type: 'transferMap', mapFile: '/etc/passwd.tmmap.json', x: 0, y: 0 }],
        },
      }),
    ).toThrow(/mapFile/);
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          door: [{ type: 'transferMap', mapFile: 'C:/maps/other.tmmap.json', x: 0, y: 0 }],
        },
      }),
    ).toThrow(/mapFile/);
  });

  it('rejects transferMap with invalid facing', () => {
    expect(() =>
      parseEventScript({
        version: 1,
        events: {
          door: [{ type: 'transferMap', mapFile: 'a.tmmap.json', x: 0, y: 0, facing: 'north' }],
        },
      }),
    ).toThrow(/facing/);
  });

  it('allows transferMap nested under conditional then/else', () => {
    const events = {
      gate: [
        {
          type: 'conditional' as const,
          if: { key: 'open' as const, op: 'eq' as const, value: true as const },
          then: [{ type: 'transferMap' as const, mapFile: 'map-b.tmmap.json', x: 2, y: 3 }],
          else: [{ type: 'setWorldVar' as const, key: 'blocked', value: true as const }],
        },
      ],
    };
    const result = parseEventScript({ version: 1, events });
    expect(result).toEqual(events);
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

  describe('giveItem', () => {
    it('parses a valid giveItem with positive amount', () => {
      const result = parseEventScript({
        version: 1,
        events: {
          chest: [{ type: 'giveItem', itemId: 'potion', amount: 3 }],
        },
      });
      expect(result.chest).toEqual([{ type: 'giveItem', itemId: 'potion', amount: 3 }]);
    });

    it('parses giveItem with a negative amount (take)', () => {
      const result = parseEventScript({
        version: 1,
        events: {
          shop: [{ type: 'giveItem', itemId: 'gold', amount: -5 }],
        },
      });
      expect(result.shop).toEqual([{ type: 'giveItem', itemId: 'gold', amount: -5 }]);
    });

    it('rejects giveItem with empty itemId', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { chest: [{ type: 'giveItem', itemId: '', amount: 1 }] },
        }),
      ).toThrow(/itemId/);
    });

    it('rejects giveItem with non-string itemId', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { chest: [{ type: 'giveItem', itemId: 42, amount: 1 }] },
        }),
      ).toThrow(/itemId/);
    });

    it('rejects giveItem with amount 0', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { chest: [{ type: 'giveItem', itemId: 'potion', amount: 0 }] },
        }),
      ).toThrow(/amount/);
    });

    it('rejects giveItem with non-integer amount', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { chest: [{ type: 'giveItem', itemId: 'potion', amount: 1.5 }] },
        }),
      ).toThrow(/amount/);
    });

    it('rejects giveItem with non-finite amount', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: {
            chest: [{ type: 'giveItem', itemId: 'potion', amount: Number.POSITIVE_INFINITY }],
          },
        }),
      ).toThrow(/amount/);
    });
  });

  describe('modifyStat', () => {
    it('parses a valid modifyStat with positive delta', () => {
      const result = parseEventScript({
        version: 1,
        events: {
          buff: [{ type: 'modifyStat', statId: 'hp', delta: 10 }],
        },
      });
      expect(result.buff).toEqual([{ type: 'modifyStat', statId: 'hp', delta: 10 }]);
    });

    it('parses modifyStat with a fractional non-zero delta', () => {
      const result = parseEventScript({
        version: 1,
        events: {
          buff: [{ type: 'modifyStat', statId: 'speed', delta: -0.5 }],
        },
      });
      expect(result.buff).toEqual([{ type: 'modifyStat', statId: 'speed', delta: -0.5 }]);
    });

    it('rejects modifyStat with empty statId', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { buff: [{ type: 'modifyStat', statId: '', delta: 1 }] },
        }),
      ).toThrow(/statId/);
    });

    it('rejects modifyStat with non-string statId', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { buff: [{ type: 'modifyStat', statId: 7, delta: 1 }] },
        }),
      ).toThrow(/statId/);
    });

    it('rejects modifyStat with delta 0', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { buff: [{ type: 'modifyStat', statId: 'hp', delta: 0 }] },
        }),
      ).toThrow(/delta/);
    });

    it('rejects modifyStat with non-finite delta', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: { buff: [{ type: 'modifyStat', statId: 'hp', delta: Number.NaN }] },
        }),
      ).toThrow(/delta/);
    });
  });

  describe('conditional source', () => {
    it('parses conditional without source (back-compat defaults to world at runtime)', () => {
      const events = {
        check: [
          {
            type: 'conditional' as const,
            if: { key: 'metElder' as const, op: 'eq' as const, value: true as const },
            then: [{ type: 'setWorldVar' as const, key: 'ok', value: true as const }],
          },
        ],
      };
      const result = parseEventScript({ version: 1, events });
      expect(result).toEqual(events);
      const cmd = result.check?.[0];
      expect(cmd).toMatchObject({
        type: 'conditional',
        if: { key: 'metElder', op: 'eq', value: true },
      });
      // source is omitted when absent so existing authored JSON round-trips identically
      expect(cmd && cmd.type === 'conditional' ? cmd.if.source : 'missing').toBeUndefined();
    });

    it.each(['world', 'item', 'stat'] as const)('parses conditional with source "%s"', (source) => {
      const result = parseEventScript({
        version: 1,
        events: {
          check: [
            {
              type: 'conditional',
              if: { key: 'foo', op: 'gte', value: 1, source },
              then: [],
            },
          ],
        },
      });
      expect(result.check).toEqual([
        {
          type: 'conditional',
          if: { key: 'foo', op: 'gte', value: 1, source },
          then: [],
        },
      ]);
    });

    it('rejects conditional with an invalid source string', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: {
            check: [
              {
                type: 'conditional',
                if: { key: 'foo', op: 'eq', value: 1, source: 'inventory' },
                then: [],
              },
            ],
          },
        }),
      ).toThrow(/source/);
    });

    it('rejects conditional source: "item" with boolean value', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: {
            check: [
              {
                type: 'conditional',
                if: { key: 'key', op: 'eq', value: true, source: 'item' },
                then: [],
              },
            ],
          },
        }),
      ).toThrow(
        'Invalid Event Script: events.check[0] (conditional) "if.value" must be a finite number when "if.source" is "item", got true.',
      );
    });

    it('rejects conditional source: "stat" with string value', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: {
            check: [
              {
                type: 'conditional',
                if: { key: 'hp', op: 'gte', value: 'full', source: 'stat' },
                then: [],
              },
            ],
          },
        }),
      ).toThrow(
        'Invalid Event Script: events.check[0] (conditional) "if.value" must be a finite number when "if.source" is "stat", got "full".',
      );
    });

    it('rejects conditional source: "item" with non-finite number value (NaN)', () => {
      expect(() =>
        parseEventScript({
          version: 1,
          events: {
            check: [
              {
                type: 'conditional',
                if: { key: 'key', op: 'eq', value: Number.NaN, source: 'item' },
                then: [],
              },
            ],
          },
        }),
      ).toThrow(
        'Invalid Event Script: events.check[0] (conditional) "if.value" must be a finite number when "if.source" is "item", got null.',
      );
    });

    it('still accepts conditional source: "world" with boolean value', () => {
      const result = parseEventScript({
        version: 1,
        events: {
          check: [
            {
              type: 'conditional',
              if: { key: 'metElder', op: 'eq', value: true, source: 'world' },
              then: [],
            },
          ],
        },
      });
      expect(result.check).toEqual([
        {
          type: 'conditional',
          if: { key: 'metElder', op: 'eq', value: true, source: 'world' },
          then: [],
        },
      ]);
    });
  });
});
