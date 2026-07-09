import { describe, expect, it } from 'vitest';
import { fixtureImageUrl, fixtureJsonUrl } from '../src/fixture-paths.js';

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
