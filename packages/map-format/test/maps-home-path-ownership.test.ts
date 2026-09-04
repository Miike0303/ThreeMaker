/**
 * Pins single ownership of the Home-relative maps directory:
 * map-format defines MAP_DIR_RELATIVE; apps must not hardcode the twin.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_MAP_FILE_RELATIVE,
  LEGACY_MAP_NAME,
  MAP_DIR_RELATIVE,
  MAP_DOCUMENT_FILE_SUFFIX,
} from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const APP_SOURCES = [
  'apps/editor/src/map-identity.ts',
  'apps/editor/vite.config.ts',
  'apps/desktop/src/map-file.ts',
  'apps/desktop/src/web-game-source.ts',
] as const;

describe('maps home path ownership', () => {
  it('exports the shared Home-relative maps root and legacy working file', () => {
    expect(MAP_DIR_RELATIVE).toBe('.threemaker/maps');
    expect(LEGACY_MAP_NAME).toBe('current');
    expect(LEGACY_MAP_FILE_RELATIVE).toBe(
      `${MAP_DIR_RELATIVE}/${LEGACY_MAP_NAME}${MAP_DOCUMENT_FILE_SUFFIX}`,
    );
  });

  it('apps import the shared MAP_DIR_RELATIVE and do not redefine the literal', () => {
    for (const relative of APP_SOURCES) {
      const source = readFileSync(join(ROOT, relative), 'utf8');
      expect(source, relative).not.toMatch(/MAP_DIR_RELATIVE\s*=\s*['"]\.threemaker\/maps['"]/);
      expect(source, relative).not.toMatch(/WEB_MAPS_HOME_PREFIX\s*=\s*['"]\.threemaker\/maps['"]/);
      expect(source, relative).not.toMatch(/DEV_MAPS_DIR\s*=\s*resolve\([^)]*['"]\.threemaker['"]/);
    }
    const editor = readFileSync(join(ROOT, 'apps/editor/src/map-identity.ts'), 'utf8');
    expect(editor).toMatch(/MAP_DIR_RELATIVE/);
    expect(editor).toMatch(/maps-home-path/);
    const desktop = readFileSync(join(ROOT, 'apps/desktop/src/map-file.ts'), 'utf8');
    expect(desktop).toMatch(/MAP_DIR_RELATIVE/);
    expect(desktop).toMatch(/@threemaker\/map-format/);
    const web = readFileSync(join(ROOT, 'apps/desktop/src/web-game-source.ts'), 'utf8');
    expect(web).toMatch(/MAP_DIR_RELATIVE/);
    const vite = readFileSync(join(ROOT, 'apps/editor/vite.config.ts'), 'utf8');
    expect(vite).toMatch(/MAP_DIR_RELATIVE/);
    expect(vite).toMatch(/maps-home-path/);
  });
});
