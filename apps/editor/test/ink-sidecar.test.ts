/**
 * L4 WU-02: pure path + story-id gates for `.ink` sidecars next to the map
 * (desktop design D7: `<mapBase>.<storyId>.ink`).
 */
import { describe, expect, it } from 'vitest';
import {
  inkSidecarRelativePath,
  isSafeStoryId,
  listInkStoryIdsFromEvents,
  tryCompileInkSource,
} from '../src/ink-sidecar.js';

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

  it('derives <mapBase>.<storyId>.ink from .tmmap.json paths', () => {
    expect(inkSidecarRelativePath('.threemaker/maps/current.tmmap.json', 'elder')).toBe(
      '.threemaker/maps/current.elder.ink',
    );
    expect(inkSidecarRelativePath('maps/map-a.tmmap.json', 'guard')).toBe('maps/map-a.guard.ink');
  });

  it('throws on unsafe story ids before path join', () => {
    expect(() => inkSidecarRelativePath('m.tmmap.json', '../x')).toThrow(/story id/i);
  });
});

describe('listInkStoryIdsFromEvents', () => {
  it('collects unique ink storyIds from showDialogue (incl. nested conditionals)', () => {
    const ids = listInkStoryIdsFromEvents({
      a: [
        { type: 'showDialogue', source: { kind: 'ink', storyId: 'elder', knot: 'start' } },
        { type: 'showDialogue', source: { kind: 'text', lines: ['hi'] } },
      ],
      b: [
        {
          type: 'conditional',
          if: { key: 'x', op: 'eq', value: true },
          then: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'guard' } }],
          else: [{ type: 'showDialogue', source: { kind: 'ink', storyId: 'elder' } }],
        },
      ],
    });
    expect(ids).toEqual(['elder', 'guard']);
  });
});

describe('tryCompileInkSource', () => {
  it('returns ok for a minimal valid story', () => {
    const result = tryCompileInkSource('=== start ===\nHello\n');
    expect(result.ok).toBe(true);
  });

  it('returns structured issues for invalid ink', () => {
    const result = tryCompileInkSource('=== start ===\n-> missing_knot\n');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
