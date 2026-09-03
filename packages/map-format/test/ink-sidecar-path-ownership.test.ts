/**
 * Pins single ownership of the Ink sidecar path + SAFE_STORY_ID gate:
 * map-format defines them; apps must not redeclare the regex or path formula.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const APP_SOURCES = [
  'apps/editor/src/ink-sidecar.ts',
  'apps/editor/src/map-identity.ts',
  'apps/editor/vite.config.ts',
  'apps/desktop/src/authored-map.ts',
  'apps/mcp-server/src/project-session.ts',
] as const;

describe('Ink sidecar path ownership', () => {
  it('apps import the shared helpers and do not redefine SAFE_STORY_ID_PATTERN', () => {
    for (const relative of APP_SOURCES) {
      const source = readFileSync(join(ROOT, relative), 'utf8');
      expect(source, relative).not.toMatch(/SAFE_STORY_ID_PATTERN\s*=/);
      expect(source, relative).not.toMatch(/SAFE_STORY_ID\s*=\s*\/\^\[A-Za-z0-9/);
    }
    const editorInk = readFileSync(join(ROOT, 'apps/editor/src/ink-sidecar.ts'), 'utf8');
    expect(editorInk).toMatch(/from '@threemaker\/map-format'/);
    const desktop = readFileSync(join(ROOT, 'apps/desktop/src/authored-map.ts'), 'utf8');
    expect(desktop).toMatch(/inkSidecarRelativePath/);
    expect(desktop).toMatch(/isSafeStoryId/);
    const mcp = readFileSync(join(ROOT, 'apps/mcp-server/src/project-session.ts'), 'utf8');
    expect(mcp).toMatch(/inkSidecarRelativePath/);
    expect(mcp).toMatch(/@threemaker\/map-format/);
  });
});
