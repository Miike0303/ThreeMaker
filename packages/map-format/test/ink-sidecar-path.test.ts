/**
 * Path + charset gate for Ink sidecars next to a `.tmmap.json` map.
 */
import { describe, expect, it } from 'vitest';
import {
  inkSidecarRelativePath,
  isSafeStoryId,
  MAP_DOCUMENT_FILE_SUFFIX,
} from '../src/ink-sidecar-path.js';

describe('isSafeStoryId / inkSidecarRelativePath', () => {
  it('accepts only path-safe story ids', () => {
    expect(isSafeStoryId('elder')).toBe(true);
    expect(isSafeStoryId('gate_01')).toBe(true);
    expect(isSafeStoryId('A-b')).toBe(true);
    expect(isSafeStoryId('')).toBe(false);
    expect(isSafeStoryId('../evil')).toBe(false);
    expect(isSafeStoryId('has.dot')).toBe(false);
    expect(isSafeStoryId('has space')).toBe(false);
  });

  it('derives <mapBase>.<storyId>.ink beside a .tmmap.json map', () => {
    expect(MAP_DOCUMENT_FILE_SUFFIX).toBe('.tmmap.json');
    expect(inkSidecarRelativePath('.threemaker/maps/current.tmmap.json', 'elder')).toBe(
      '.threemaker/maps/current.elder.ink',
    );
    expect(inkSidecarRelativePath('maps/map-a.tmmap.json', 'guard')).toBe('maps/map-a.guard.ink');
    expect(inkSidecarRelativePath('current.tmmap.json', 'intro')).toBe('current.intro.ink');
  });

  it('throws on unsafe story ids before path join', () => {
    expect(() => inkSidecarRelativePath('m.tmmap.json', '../x')).toThrow(/story id/i);
  });
});
