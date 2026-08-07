import { describe, expect, it } from 'vitest';
import {
  CURRENT_GAME_DEFS_VERSION,
  GAME_DEFS_MAGIC,
  parseGameDefs,
  parseGameDefsJson,
} from '../src/game-defs.js';

function validDoc(overrides: Record<string, unknown> = {}) {
  return {
    magic: GAME_DEFS_MAGIC,
    version: CURRENT_GAME_DEFS_VERSION,
    items: [{ id: 'potion', name: 'Potion' }],
    stats: [{ id: 'hp', name: 'Hit Points', base: 10, min: 0, max: 99 }],
    ...overrides,
  };
}

describe('parseGameDefs', () => {
  it('accepts a valid document', () => {
    const doc = parseGameDefs(validDoc());
    expect(doc.magic).toBe(GAME_DEFS_MAGIC);
    expect(doc.version).toBe(1);
    expect(doc.items).toEqual([{ id: 'potion', name: 'Potion' }]);
    expect(doc.stats).toEqual([{ id: 'hp', name: 'Hit Points', base: 10, min: 0, max: 99 }]);
  });

  it('accepts empty items and stats arrays', () => {
    const doc = parseGameDefs(validDoc({ items: [], stats: [] }));
    expect(doc.items).toEqual([]);
    expect(doc.stats).toEqual([]);
  });

  it('throws on non-object root', () => {
    expect(() => parseGameDefs(null)).toThrow(/object/i);
    expect(() => parseGameDefs(42)).toThrow(/object/i);
  });

  it('throws on wrong magic', () => {
    expect(() => parseGameDefs(validDoc({ magic: 'other' }))).toThrow(/magic/i);
  });

  it('throws on wrong version', () => {
    expect(() => parseGameDefs(validDoc({ version: 2 }))).toThrow(/version/i);
    expect(() => parseGameDefs(validDoc({ version: '1' }))).toThrow(/version/i);
  });

  it('throws when items or stats is not an array', () => {
    expect(() => parseGameDefs(validDoc({ items: {} }))).toThrow(/items/i);
    expect(() => parseGameDefs(validDoc({ stats: null }))).toThrow(/stats/i);
  });

  it('throws on empty or non-string item id/name naming the index', () => {
    expect(() => parseGameDefs(validDoc({ items: [{ id: '', name: 'Potion' }] }))).toThrow(
      /items\[0\].*id/i,
    );
    expect(() => parseGameDefs(validDoc({ items: [{ id: 'potion', name: '' }] }))).toThrow(
      /items\[0\].*name/i,
    );
    expect(() => parseGameDefs(validDoc({ items: [{ id: 1, name: 'Potion' }] }))).toThrow(
      /items\[0\].*id/i,
    );
  });

  it('throws on empty or non-string stat id/name naming the index', () => {
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: '', name: 'HP', base: 1, min: 0, max: 10 }] })),
    ).toThrow(/stats\[0\].*id/i);
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'hp', name: 3, base: 1, min: 0, max: 10 }] })),
    ).toThrow(/stats\[0\].*name/i);
  });

  it('throws on duplicate item ids naming both indexes', () => {
    expect(() =>
      parseGameDefs(
        validDoc({
          items: [
            { id: 'potion', name: 'A' },
            { id: 'potion', name: 'B' },
          ],
        }),
      ),
    ).toThrow(/duplicate.*item.*potion/i);
  });

  it('throws on duplicate stat ids naming both indexes', () => {
    expect(() =>
      parseGameDefs(
        validDoc({
          stats: [
            { id: 'hp', name: 'A', base: 1, min: 0, max: 10 },
            { id: 'hp', name: 'B', base: 2, min: 0, max: 10 },
          ],
        }),
      ),
    ).toThrow(/duplicate.*stat.*hp/i);
  });

  it('allows the same id in items and stats (namespaces are separate)', () => {
    const doc = parseGameDefs(
      validDoc({
        items: [{ id: 'hp', name: 'HP Potion' }],
        stats: [{ id: 'hp', name: 'Hit Points', base: 10, min: 0, max: 99 }],
      }),
    );
    expect(doc.items[0]?.id).toBe('hp');
    expect(doc.stats[0]?.id).toBe('hp');
  });

  it('throws on non-finite base/min/max naming the field and index', () => {
    expect(() =>
      parseGameDefs(
        validDoc({ stats: [{ id: 'hp', name: 'HP', base: Number.NaN, min: 0, max: 10 }] }),
      ),
    ).toThrow(/stats\[0\].*base/i);
    expect(() =>
      parseGameDefs(
        validDoc({
          stats: [{ id: 'hp', name: 'HP', base: 1, min: Number.POSITIVE_INFINITY, max: 10 }],
        }),
      ),
    ).toThrow(/stats\[0\].*min/i);
    expect(() =>
      parseGameDefs(
        validDoc({
          stats: [{ id: 'hp', name: 'HP', base: 1, min: 0, max: Number.NEGATIVE_INFINITY }],
        }),
      ),
    ).toThrow(/stats\[0\].*max/i);
  });

  it('throws when min > max', () => {
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'hp', name: 'HP', base: 5, min: 10, max: 0 }] })),
    ).toThrow(/stats\[0\].*min.*>.*max/i);
  });

  it('throws when base is outside [min, max]', () => {
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'hp', name: 'HP', base: -1, min: 0, max: 10 }] })),
    ).toThrow(/stats\[0\].*base/i);
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'hp', name: 'HP', base: 11, min: 0, max: 10 }] })),
    ).toThrow(/stats\[0\].*base/i);
  });

  it('accepts base equal to min or max', () => {
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'a', name: 'A', base: 0, min: 0, max: 10 }] })),
    ).not.toThrow();
    expect(() =>
      parseGameDefs(validDoc({ stats: [{ id: 'b', name: 'B', base: 10, min: 0, max: 10 }] })),
    ).not.toThrow();
  });
});

describe('parseGameDefsJson', () => {
  it('parses valid JSON text', () => {
    const doc = parseGameDefsJson(JSON.stringify(validDoc()));
    expect(doc.items[0]?.id).toBe('potion');
  });

  it('wraps JSON syntax errors in a clear message', () => {
    expect(() => parseGameDefsJson('{not json')).toThrow(/json/i);
  });

  it('still throws validation errors after a successful parse', () => {
    expect(() => parseGameDefsJson(JSON.stringify(validDoc({ magic: 'x' })))).toThrow(/magic/i);
  });
});
