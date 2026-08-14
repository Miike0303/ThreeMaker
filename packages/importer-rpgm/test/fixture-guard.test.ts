import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  /**
   * This test file's own directory. `fixtures/` is NOT a valid stand-in for
   * "a directory that exists": `.gitignore` ignores the whole folder, so a
   * fresh clone has no `fixtures/` at all and asserting on it passes locally
   * while failing on a runner. Pick something that ships with the repo.
   */
  const presentDir = dirname(fileURLToPath(import.meta.url));

  /** Restores `CI` to whatever the surrounding environment had — these cases must not depend on it. */
  function withCi(value: string | undefined, run: () => void): void {
    const previous = process.env.CI;
    if (value === undefined) delete process.env.CI;
    else process.env.CI = value;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  }

  it('does not skip a directory that exists, in CI or out of it', () => {
    withCi('true', () => expect(skipWithoutFixture(presentDir)).toBe(false));
    withCi(undefined, () => expect(skipWithoutFixture(presentDir)).toBe(false));
  });

  it('does not skip when CI is unset even for an absent path', () => {
    withCi(undefined, () => expect(skipWithoutFixture(missingDir)).toBe(false));
  });

  it('skips in CI when the directory is absent', () => {
    withCi('true', () => expect(skipWithoutFixture(missingDir)).toBe(true));
  });
});
