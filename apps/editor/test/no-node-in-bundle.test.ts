import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EDITOR_ROOT = join(TEST_DIR, '..');

/**
 * Patterns that would indicate the webview entry bundle can reach Node-only
 * APIs directly -- the spec's "No Node imports in entry bundle" requirement
 * (editor-app capability). Catalog access must cross the Tauri IPC boundary
 * (catalog-client.ts) instead; the dev-only `/api/dev-catalog/*` fallback and
 * `better-sqlite3` live in `dev-server/catalog-api.ts` and `vite.config.ts`,
 * which are Node-side build/dev-server code, never bundled into the browser
 * entry this test inspects.
 */
const BANNED_PATTERNS: readonly RegExp[] = [
  /require\(["']node:/,
  /from\s*["']node:/,
  /require\(["']fs["']\)/,
  /require\(["']path["']\)/,
  /better-sqlite3/,
  /require\(["']better-sqlite3["']\)/,
];

describe('editor webview bundle', () => {
  it('contains no Node-only imports in the built entry bundle', async () => {
    await build({
      root: EDITOR_ROOT,
      configFile: join(EDITOR_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: true },
    });

    const assetsDir = join(EDITOR_ROOT, 'dist', 'assets');
    const jsFiles = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const fileName of jsFiles) {
      const contents = readFileSync(join(assetsDir, fileName), 'utf8');
      for (const pattern of BANNED_PATTERNS) {
        expect(
          pattern.test(contents),
          `${fileName} matched banned Node-only pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
