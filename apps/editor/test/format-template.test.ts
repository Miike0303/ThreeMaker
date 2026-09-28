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
