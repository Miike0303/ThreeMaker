/**
 * `parseGameManifest` (rpgm-whole-game-import change): validates the
 * `manifest.json` `convert-rpgm-game` writes (mirrors
 * `packages/assets/src/convert-rpgm-game.ts`'s own `GameManifest` shape --
 * desktop does not depend on `@threemaker/assets`, so this is an
 * independent parser over the same JSON contract, same convention as
 * `map-format`'s own hand-validated schema).
 */
import { describe, expect, it } from 'vitest';
import { parseGameManifest } from '../src/game-manifest.js';

describe('parseGameManifest', () => {
  it('parses a valid manifest with no actorSheet', () => {
    const manifest = parseGameManifest({
      maps: [
        { mapId: 1, name: 'Town Square', file: 'map001.tmmap.json', slotsResolved: 7 },
        { mapId: 2, name: 'Dungeon Depths', file: 'map002.tmmap.json', slotsResolved: 5 },
      ],
    });

    expect(manifest.maps).toHaveLength(2);
    expect(manifest.maps[0]).toEqual({
      mapId: 1,
      name: 'Town Square',
      file: 'map001.tmmap.json',
      slotsResolved: 7,
    });
    expect(manifest.actorSheet).toBeUndefined();
  });

  it('parses a valid manifest with an actorSheet', () => {
    const manifest = parseGameManifest({
      maps: [{ mapId: 1, name: 'Town Square', file: 'map001.tmmap.json', slotsResolved: 7 }],
      actorSheet: { object: 'sha-actor1', characterIndex: 0 },
    });

    expect(manifest.actorSheet).toEqual({ object: 'sha-actor1', characterIndex: 0 });
  });

  it('throws when the top-level value is not an object', () => {
    expect(() => parseGameManifest(null)).toThrow(/expected an object/);
    expect(() => parseGameManifest('nope')).toThrow(/expected an object/);
  });

  it('throws when "maps" is missing or not an array', () => {
    expect(() => parseGameManifest({})).toThrow(/"maps" must be an array/);
    expect(() => parseGameManifest({ maps: 'nope' })).toThrow(/"maps" must be an array/);
  });

  it('throws when a map entry is missing a required field', () => {
    expect(() =>
      parseGameManifest({ maps: [{ mapId: 1, name: 'Town', file: 'map001.tmmap.json' }] }),
    ).toThrow(/Invalid manifest entry/);
  });

  it('throws when a map entry has the wrong field type', () => {
    expect(() =>
      parseGameManifest({
        maps: [{ mapId: '1', name: 'Town', file: 'map001.tmmap.json', slotsResolved: 0 }],
      }),
    ).toThrow(/Invalid manifest entry/);
  });

  it('throws when actorSheet is present but malformed', () => {
    expect(() =>
      parseGameManifest({
        maps: [{ mapId: 1, name: 'Town', file: 'map001.tmmap.json', slotsResolved: 0 }],
        actorSheet: { object: 'sha-actor1' },
      }),
    ).toThrow(/Invalid manifest actorSheet/);
  });
});
