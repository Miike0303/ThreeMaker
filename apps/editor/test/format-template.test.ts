import { describe, expect, it } from 'vitest';
import { formatTemplate } from '../src/format-template.js';

describe('formatTemplate', () => {
  it('substitutes a placeholder whose identifier contains a digit', () => {
    expect(formatTemplate('Tile {tile2}', { tile2: 42 })).toBe('Tile 42');
  });

  it('substitutes a placeholder whose name contains an underscore', () => {
    expect(formatTemplate('Tile {tile_id}', { tile_id: 42 })).toBe('Tile 42');
  });

  it('substitutes a single placeholder', () => {
    expect(formatTemplate('{count} assets', { count: 5 })).toBe('5 assets');
  });

  it('substitutes multiple placeholders', () => {
    expect(
      formatTemplate('{start}–{end} of {count} assets', { start: 1, end: 100, count: 250 }),
    ).toBe('1–100 of 250 assets');
  });

  it('leaves unmatched placeholders untouched', () => {
    expect(formatTemplate('{missing} assets', {})).toBe('{missing} assets');
  });

  it('leaves empty braces untouched even when values contain an empty key', () => {
    expect(formatTemplate('Keep {} visible', { '': 'replacement' })).toBe('Keep {} visible');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(formatTemplate('{n} and {n}', { n: 3 })).toBe('3 and 3');
  });

  it.each(['$&', '$$', '$`', "$'"])('inserts a value containing %s literally', (name) => {
    expect(formatTemplate('Delete saved map "{name}"?', { name })).toBe(
      `Delete saved map "${name}"?`,
    );
  });

  it('does not substitute placeholders that appear inside a value', () => {
    expect(formatTemplate('{name} on {floor}', { name: '{floor}', floor: 'Floor 1' })).toBe(
      '{floor} on Floor 1',
    );
  });
});

it('substitutes a placeholder containing uppercase identifier characters', () => {
  expect(formatTemplate('Tile {TileId}', { TileId: 42 })).toBe('Tile 42');
});

it('substitutes a numeric placeholder name', () => {
  expect(formatTemplate('Tile {0}', { '0': 42 })).toBe('Tile 42');
});

it('substitutes a zero placeholder value', () => {
  expect(formatTemplate('{count} assets', { count: 0 })).toBe('0 assets');
});

it('leaves hyphenated placeholder names unchanged', () => {
  expect(formatTemplate('Tile {tile-id}', { 'tile-id': 42 })).toBe('Tile {tile-id}');
});

it('leaves a placeholder without its closing brace unchanged', () => {
  expect(formatTemplate('Map {name', { name: 'Harbor' })).toBe('Map {name');
});

it('leaves a placeholder without its opening brace unchanged', () => {
  expect(formatTemplate('Map name}', { name: 'Harbor' })).toBe('Map name}');
});

it('leaves a caret in a placeholder identifier untouched', () => {
  expect(formatTemplate('Tile {tile^id}', { 'tile^id': 42 })).toBe('Tile {tile^id}');
});
