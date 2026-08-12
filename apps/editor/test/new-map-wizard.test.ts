import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_NAME,
  DEFAULT_MAP_WIDTH,
  MAP_DIMENSION_MAX,
  MAP_DIMENSION_MIN,
  normalizeMapDimension,
  normalizeNewMapName,
  validateNewMapDraft,
} from '../src/new-map-wizard.js';

describe('new map wizard', () => {
  it('exports safe authoring defaults and bounds', () => {
    expect(DEFAULT_MAP_NAME).toBe('New Map');
    expect(DEFAULT_MAP_WIDTH).toBe(20);
    expect(DEFAULT_MAP_HEIGHT).toBe(15);
    expect(MAP_DIMENSION_MIN).toBe(8);
    expect(MAP_DIMENSION_MAX).toBe(128);
  });

  it('normalizes map names without accepting blank text', () => {
    expect(normalizeNewMapName('  Forest Path  ')).toBe('Forest Path');
    expect(normalizeNewMapName('   ')).toBeNull();
  });

  it('normalizes only finite integer dimensions inside the bounds', () => {
    expect(normalizeMapDimension(' 24 ')).toBe(24);
    expect(normalizeMapDimension(8)).toBe(8);
    expect(normalizeMapDimension(128)).toBe(128);
    expect(normalizeMapDimension('')).toBeNull();
    expect(normalizeMapDimension('12.5')).toBeNull();
    expect(normalizeMapDimension(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeMapDimension(7)).toBeNull();
    expect(normalizeMapDimension(129)).toBeNull();
  });

  it('returns normalized creation values only for a fully valid draft', () => {
    expect(validateNewMapDraft({ name: '  Castle  ', width: '32', height: '18' })).toEqual({
      valid: true,
      value: { name: 'Castle', width: 32, height: 18 },
    });
  });

  it('keeps invalid draft text out of the creation seam', () => {
    expect(validateNewMapDraft({ name: '', width: 'oops', height: '7' })).toEqual({
      valid: false,
      errors: { name: true, width: true, height: true },
    });
  });
});
