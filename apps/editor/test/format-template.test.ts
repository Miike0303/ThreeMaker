import { describe, expect, it } from 'vitest';
import { formatTemplate } from '../src/format-template.js';

describe('formatTemplate', () => {
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

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(formatTemplate('{n} and {n}', { n: 3 })).toBe('3 and 3');
  });
});
