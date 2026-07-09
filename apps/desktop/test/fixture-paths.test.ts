import { describe, expect, it } from 'vitest';
import { fixtureCharacterUrl, fixtureImageUrl, fixtureJsonUrl } from '../src/fixture-paths.js';

const FIXTURES_DIR = 'C:/Projects/ThreeMaker/fixtures/roseliam';

describe('fixtureJsonUrl', () => {
  it('builds a Vite /@fs/ absolute-path URL for a fixture JSON file', () => {
    expect(fixtureJsonUrl(FIXTURES_DIR, 'Map007.json')).toBe(
      '/@fs/C:/Projects/ThreeMaker/fixtures/roseliam/Map007.json',
    );
  });
});

describe('fixtureImageUrl', () => {
  it('builds a Vite /@fs/ absolute-path URL for a tileset sheet image under img/tilesets/', () => {
    expect(fixtureImageUrl(FIXTURES_DIR, 'Dungeon_A1')).toBe(
      '/@fs/C:/Projects/ThreeMaker/fixtures/roseliam/img/tilesets/Dungeon_A1.png',
    );
  });
});

describe('fixtureCharacterUrl', () => {
  it('builds a Vite /@fs/ absolute-path URL for a character sheet image under img/characters/', () => {
    expect(fixtureCharacterUrl(FIXTURES_DIR, 'Actor1')).toBe(
      '/@fs/C:/Projects/ThreeMaker/fixtures/roseliam/img/characters/Actor1.png',
    );
  });
});
