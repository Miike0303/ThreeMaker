import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROSELIAM_FIXTURE_DIR, requireFixture, skipWithoutFixture } from './fixture-path.js';

describe('requireFixture', () => {
  it('throws a clear, actionable error when the fixture folder is absent', () => {
    const missingDir = join(ROSELIAM_FIXTURE_DIR, '..', 'does-not-exist');
    expect(() => requireFixture(missingDir)).toThrow(/fixtures\/README\.md/);
  });

  it.skipIf(skipWithoutFixture(ROSELIAM_FIXTURE_DIR))(
    'does not throw for the real Roseliam fixture (present locally, git-ignored)',
    () => {
      // If this throws, regenerate the fixture per fixtures/README.md before running tests.
      expect(() => requireFixture(ROSELIAM_FIXTURE_DIR)).not.toThrow();
    },
  );
});

describe('skipWithoutFixture', () => {
  const missingDir = join(ROSELIAM_FIXTURE_DIR, '..', 'does-not-exist');
  const alwaysPresentDir = join(ROSELIAM_FIXTURE_DIR, '..');

  it('returns false when the directory exists', () => {
    expect(skipWithoutFixture(alwaysPresentDir)).toBe(false);
  });

  it('does not skip when CI is unset even for an absent path', () => {
    const previous = process.env.CI;
    delete process.env.CI;
    try {
      expect(skipWithoutFixture(missingDir)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  });

  it('skips in CI when the directory is absent', () => {
    const previous = process.env.CI;
    process.env.CI = 'true';
    try {
      expect(skipWithoutFixture(missingDir)).toBe(true);
      expect(skipWithoutFixture(alwaysPresentDir)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  });
});
