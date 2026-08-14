import { describe, expect, it } from 'vitest';
import { compileInk } from '../src/compile.js';
import { captureInkStoryStates, restoreInkStoryStates } from '../src/ink-story-state.js';

/**
 * Three printable lines plus a variable written between the first two.
 * Continue twice, save, reload onto a fresh compile: the next line must be
 * the third, and `token` must still be 1.
 */
const MID_STORY_SOURCE = `VAR token = 0
Alpha.
~ token = 1
Beta.
Gamma.
-> END
`;

function compileMidStory() {
  return compileInk(MID_STORY_SOURCE);
}

describe('captureInkStoryStates / restoreInkStoryStates', () => {
  it('captures every registered story as JSON keyed by storyId', () => {
    const elder = compileInk('Hello, traveler.\n-> END\n');
    const guard = compileInk('Halt.\n-> END\n');
    const saved = captureInkStoryStates(
      new Map([
        ['elder', elder],
        ['guard', guard],
      ]),
    );
    expect(Object.keys(saved).sort()).toEqual(['elder', 'guard']);
    expect(saved.elder?.length).toBeGreaterThan(0);
    expect(saved.guard?.length).toBeGreaterThan(0);
    expect(saved.elder).not.toBe(saved.guard);
  });

  it('restores a mid-story cursor onto a fresh compile so the next line matches', () => {
    const live = compileMidStory();
    expect(live.Continue()?.trim()).toBe('Alpha.');
    expect(live.Continue()?.trim()).toBe('Beta.');

    const saved = captureInkStoryStates(new Map([['elder', live]]));

    const reloaded = compileMidStory();
    const result = restoreInkStoryStates(new Map([['elder', reloaded]]), saved);

    expect(result).toEqual({ restored: ['elder'], skipped: [] });
    expect(reloaded.Continue()?.trim()).toBe('Gamma.');
    expect(reloaded.variablesState.$('token')).toBe(1);
  });

  it('skips saved ids that are not in the registry without throwing', () => {
    const live = compileMidStory();
    const saved = captureInkStoryStates(new Map([['elder', live]]));
    saved.retired = saved.elder;

    const result = restoreInkStoryStates(new Map([['elder', compileMidStory()]]), saved);

    expect(result.restored).toEqual(['elder']);
    expect(result.skipped).toEqual(['retired']);
  });

  it('skips a story whose saved JSON cannot be loaded and still restores the others', () => {
    const elder = compileMidStory();
    elder.Continue();
    elder.Continue();
    const guard = compileInk('Halt.\nStay back.\n-> END\n');
    guard.Continue();

    const saved = captureInkStoryStates(
      new Map([
        ['elder', elder],
        ['guard', guard],
      ]),
    );
    saved.guard = '{not-valid-ink-state';

    const freshElder = compileMidStory();
    const freshGuard = compileInk('Halt.\nStay back.\n-> END\n');
    const result = restoreInkStoryStates(
      new Map([
        ['elder', freshElder],
        ['guard', freshGuard],
      ]),
      saved,
    );

    expect(result.restored).toEqual(['elder']);
    expect(result.skipped).toEqual(['guard']);
    expect(freshElder.Continue()?.trim()).toBe('Gamma.');
    expect(freshGuard.Continue()?.trim()).toBe('Halt.');
  });

  it('returns empty restored and skipped when the save has no story entries', () => {
    const result = restoreInkStoryStates(new Map([['elder', compileMidStory()]]), {});
    expect(result).toEqual({ restored: [], skipped: [] });
  });
});
