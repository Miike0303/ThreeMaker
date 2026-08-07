/**
 * Build a self-contained static web site under `apps/desktop/dist-web/` (C9 WU-02).
 *
 * Copies the Vite build from `apps/desktop/dist/` into the out dir, then writes
 * the playable game payload under `out/game/`. That keeps `dist/` free of the
 * multi-hundred-MB map/asset payload so Tauri's `frontendDist: "../dist"` does
 * not bloat the desktop installer.
 *
 * Source for the game payload: `~/.threemaker/maps/**` (manifest, maps, ink
 * sidecars) plus only the asset-store objects those maps reference.
 *
 * Usage:
 *   node scripts/export-web-game.mjs [--maps-dir <path>] [--out <path>]
 */

import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256_HEX = /^[0-9a-f]{64}$/;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_APP_DIR = resolve(SCRIPT_DIR, '..', 'apps', 'desktop');
const DEFAULT_DIST_DIR = join(DESKTOP_APP_DIR, 'dist');
const DEFAULT_OUT_DIR = join(DESKTOP_APP_DIR, 'dist-web');

/**
 * Walk a map document (or any JSON tree) and collect content-addressed
 * asset-store shas from known fields:
 * - `tileset.slots[*].object` (sheet PNGs)
 * - `floors[*].lightMap`
 * - `npcs[*].sprite.object`
 * - `props[*].object` (glTF/glb)
 * - any other `object` / `lightMap` string that is exactly 64 lowercase hex
 *   (covers manifest `actorSheet.object` when the same helper is reused)
 */
export function extractAssetSha256Refs(value) {
  const out = new Set();

  function consider(candidate) {
    if (typeof candidate === 'string' && SHA256_HEX.test(candidate)) {
      out.add(candidate);
    }
  }

  function walk(node) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'object' || key === 'lightMap') {
        consider(child);
      } else if (key === 'sprite' && child && typeof child === 'object' && !Array.isArray(child)) {
        consider(/** @type {{ object?: unknown }} */ (child).object);
        walk(child);
      } else {
        walk(child);
      }
    }
  }

  walk(value);
  return [...out];
}

/**
 * @param {string[]} argv
 * @returns {{ mapsDir: string, outDir: string }}
 */
export function parseExportArgs(argv) {
  let mapsDir = join(homedir(), '.threemaker', 'maps');
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--maps-dir') {
      mapsDir = resolve(argv[++i] ?? mapsDir);
    } else if (arg === '--out') {
      outDir = resolve(argv[++i] ?? outDir);
    }
  }
  return { mapsDir, outDir };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>} absolute file paths
 */
async function listFilesRecursive(dir) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Copy Vite `dist/` contents into the web out dir (files only; no nesting of
 * the `dist` folder name itself).
 *
 * @param {string} distDir
 * @param {string} outDir
 */
export async function copyDistIntoOut(distDir, outDir) {
  await mkdir(outDir, { recursive: true });
  let entries;
  try {
    entries = await readdir(distDir, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error(`export-web-game: Vite dist not found at ${distDir} (run vite build first)`);
    }
    throw error;
  }
  for (const entry of entries) {
    const src = join(distDir, entry.name);
    const dest = join(outDir, entry.name);
    await cp(src, dest, { recursive: true });
  }
}

/**
 * Copy a playable game payload into `outDir` (maps + referenced asset-store
 * objects). Callers that want the self-contained static site should use
 * {@link exportWebSite} so the payload lands under `out/game/`.
 *
 * @param {string} mapsDir
 * @param {string} outDir
 */
export async function exportWebGame(mapsDir, outDir) {
  const mapFiles = await listFilesRecursive(mapsDir);
  if (mapFiles.length === 0) {
    console.log(`export-web-game: no files under ${mapsDir}`);
    console.log('maps copied: 0');
    console.log('objects copied: 0');
    console.log('total bytes: 0');
    return { mapsCopied: 0, objectsCopied: 0, totalBytes: 0 };
  }

  await mkdir(outDir, { recursive: true });

  let mapsCopied = 0;
  let totalBytes = 0;
  /** @type {Set<string>} */
  const shas = new Set();

  for (const abs of mapFiles) {
    const rel = relative(mapsDir, abs).replaceAll('\\', '/');
    const dest = join(outDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(abs, dest);
    mapsCopied += 1;
    totalBytes += (await stat(abs)).size;

    if (rel.endsWith('.json')) {
      try {
        const text = await readFile(abs, 'utf8');
        const parsed = JSON.parse(text);
        for (const sha of extractAssetSha256Refs(parsed)) {
          shas.add(sha);
        }
      } catch {
        // Non-map JSON (or broken) — still copied; skip sha walk.
      }
    }
  }

  const assetStoreRoot = join(dirname(mapsDir), 'asset-store', 'objects');
  let objectsCopied = 0;
  for (const sha of shas) {
    const relObject = join(sha.slice(0, 2), sha);
    const src = join(assetStoreRoot, relObject);
    const dest = join(outDir, 'asset-store', 'objects', relObject);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      objectsCopied += 1;
      totalBytes += (await stat(src)).size;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
        console.warn(`export-web-game: missing object ${sha} (skipped)`);
        continue;
      }
      throw error;
    }
  }

  // Tiny marker so operators can confirm a payload was written.
  await writeFile(
    join(outDir, '.export-meta.json'),
    `${JSON.stringify({ mapsCopied, objectsCopied, totalBytes }, null, 2)}\n`,
    'utf8',
  );

  console.log(`export-web-game: maps-dir=${mapsDir}`);
  console.log(`export-web-game: out=${outDir}`);
  console.log(`maps copied: ${mapsCopied}`);
  console.log(`objects copied: ${objectsCopied}`);
  console.log(`total bytes: ${totalBytes}`);

  return { mapsCopied, objectsCopied, totalBytes };
}

/**
 * Self-contained static site: copy Vite `distDir` → `outDir`, then write the
 * game payload under `outDir/game/`. Does not write into `distDir`.
 *
 * @param {string} mapsDir
 * @param {string} outDir
 * @param {string} distDir
 */
export async function exportWebSite(mapsDir, outDir, distDir) {
  await copyDistIntoOut(distDir, outDir);
  const gameOut = join(outDir, 'game');
  return exportWebGame(mapsDir, gameOut);
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { mapsDir, outDir } = parseExportArgs(process.argv.slice(2));
  console.log(`export-web-game: dist=${DEFAULT_DIST_DIR}`);
  console.log(`export-web-game: site-out=${outDir}`);
  await exportWebSite(mapsDir, outDir, DEFAULT_DIST_DIR);
}
