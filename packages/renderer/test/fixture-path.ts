import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** Repo-root `fixtures/roseliam/` — git-ignored, see `fixtures/README.md`. */
export const ROSELIAM_FIXTURE_DIR = join(TEST_DIR, '..', '..', '..', 'fixtures', 'roseliam');

/** `fixtures/roseliam/img/tilesets/` — the tileset PNGs referenced by the fixture maps. */
export const ROSELIAM_TILESETS_IMG_DIR = join(ROSELIAM_FIXTURE_DIR, 'img', 'tilesets');

/**
 * Fixtures are real, copyrighted RPG Maker data and are git-ignored. Call
 * this before any test that depends on them so a missing fixture fails
 * loudly with regeneration instructions instead of a confusing ENOENT deep
 * inside a reader.
 */
export function requireFixture(dir: string): void {
  if (!existsSync(dir)) {
    throw new Error(
      `Fixture missing: "${dir}" not found. See fixtures/README.md for how to regenerate it from a local RPG Maker MV/MZ project.`,
    );
  }
}
