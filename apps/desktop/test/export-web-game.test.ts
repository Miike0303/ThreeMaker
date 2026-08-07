/**
 * Pure helpers + filesystem layout for `scripts/export-web-game.mjs` (C9 WU-02).
 * Asserts default out is `dist-web` and that the Vite `dist/` tree is never
 * used as the game-payload destination.
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportWebSite,
  extractAssetSha256Refs,
  parseExportArgs,
} from '../../../scripts/export-web-game.mjs';

const SHA_NPC = 'a1'.padEnd(64, '1');
const SHA_PROP = 'b2'.padEnd(64, '2');
const SHA_LIGHT = 'c3'.padEnd(64, '3');
const SHA_TILE = 'd4'.padEnd(64, '4');

describe('extractAssetSha256Refs', () => {
  it('collects npc sprite, prop object, floor lightMap, and tileset slot object shas', () => {
    const doc = {
      tileset: {
        slots: {
          A1: { object: SHA_TILE },
          A2: {},
        },
      },
      floors: [{ id: 'f0', lightMap: SHA_LIGHT }, { id: 'f1' }],
      npcs: [
        {
          id: 'elder',
          sprite: { object: SHA_NPC, characterIndex: 0 },
        },
      ],
      props: [{ id: 'crate', object: SHA_PROP }],
    };

    const shas = extractAssetSha256Refs(doc);

    expect(new Set(shas)).toEqual(new Set([SHA_NPC, SHA_PROP, SHA_LIGHT, SHA_TILE]));
  });

  it('ignores non-sha256 strings on known fields and returns unique shas', () => {
    const doc = {
      floors: [{ lightMap: 'not-a-sha' }, { lightMap: SHA_LIGHT }],
      npcs: [{ sprite: { object: SHA_NPC } }, { sprite: { object: SHA_NPC } }],
      props: [{ object: 'short' }],
    };

    const shas = extractAssetSha256Refs(doc);

    expect(shas).toEqual([SHA_LIGHT, SHA_NPC]);
  });

  it('returns empty for non-objects', () => {
    expect(extractAssetSha256Refs(null)).toEqual([]);
    expect(extractAssetSha256Refs('x')).toEqual([]);
  });
});

describe('parseExportArgs', () => {
  it('defaults out to apps/desktop/dist-web (not dist/game)', () => {
    const { outDir } = parseExportArgs([]);
    const normalized = outDir.replaceAll('\\', '/');
    expect(normalized.endsWith('apps/desktop/dist-web')).toBe(true);
    expect(normalized.endsWith('apps/desktop/dist/game')).toBe(false);
    expect(normalized.includes('/dist/game')).toBe(false);
  });

  it('honors --out override', () => {
    const custom = join(tmpdir(), 'tm-custom-web-out');
    const { outDir } = parseExportArgs(['--out', custom]);
    expect(resolve(outDir)).toBe(resolve(custom));
  });
});

describe('exportWebSite', () => {
  it('copies vite dist into out/game sibling site and does not write into dist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tm-export-web-'));
    try {
      const distDir = join(root, 'dist');
      const outDir = join(root, 'dist-web');
      const mapsDir = join(root, 'maps');
      await mkdir(distDir, { recursive: true });
      await mkdir(mapsDir, { recursive: true });
      await writeFile(join(distDir, 'index.html'), '<html>vite</html>\n', 'utf8');
      await writeFile(join(mapsDir, 'manifest.json'), '{"version":1}\n', 'utf8');

      await exportWebSite(mapsDir, outDir, distDir);

      // dist stays clean for Tauri frontendDist — no game payload written there.
      await expect(access(join(distDir, 'game'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(distDir, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(join(distDir, 'index.html'), 'utf8')).toContain('vite');

      // Self-contained site: vite assets + game/ payload.
      expect(await readFile(join(outDir, 'index.html'), 'utf8')).toContain('vite');
      expect(await readFile(join(outDir, 'game', 'manifest.json'), 'utf8')).toContain(
        '"version":1',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
