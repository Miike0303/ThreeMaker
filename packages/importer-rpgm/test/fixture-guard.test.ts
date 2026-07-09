import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROSELIAM_FIXTURE_DIR, requireFixture } from './fixture-path.js';

describe('requireFixture', () => {
  it('throws a clear, actionable error when the fixture folder is absent', () => {
    const missingDir = join(ROSELIAM_FIXTURE_DIR, '..', 'does-not-exist');
    expect(() => requireFixture(missingDir)).toThrow(/fixtures\/README\.md/);
  });

  it('does not throw for the real Roseliam fixture (present locally, git-ignored)', () => {
    // If this throws, regenerate the fixture per fixtures/README.md before running tests.
    expect(() => requireFixture(ROSELIAM_FIXTURE_DIR)).not.toThrow();
  });
});
