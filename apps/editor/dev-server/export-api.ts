// Node-side helper for `vite.config.ts`'s dev-only export middleware (Slice
// 5: "rpgm-export").
//
// IMPORTANT: this file must NOT import `@threemaker/exporter-rpgm` (or any
// other workspace TS package) as a VALUE -- see `catalog-api.ts`'s module
// doc for why: Vite's config-file loader resolves `vite.config.ts`'s import
// graph (which pulls this file in) through Node's own ESM resolver, which
// cannot follow a workspace package's internal relative `./foo.js`
// specifiers back to their real `foo.ts` source files. Importing
// `@threemaker/exporter-rpgm/node` directly here breaks `vite build`/`vite
// dev` with `ERR_MODULE_NOT_FOUND` (verified: this was the exact failure
// caught by `no-node-in-bundle.test.ts`'s real `vite build` run in this
// slice's first implementation attempt). Instead, this shells out to the
// package's own `tsx`-run CLI (`packages/exporter-rpgm/src/cli.ts`) in a
// separate Node process -- `tsx`'s own loader DOES correctly resolve those
// specifiers (same reason every workspace package's CLI is documented to
// run via `tsx`, never plain `node`), and the child process is fully
// isolated from Vite's config-loading graph. `import type` for the
// `MapDocument`/`ExportResult` shapes below is safe (type-only imports are
// erased before resolution ever happens), only VALUE imports are the
// problem.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportResult } from '@threemaker/exporter-rpgm';
import type { MapDocument } from '@threemaker/map-format';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(THIS_DIR, '..', '..', '..');
const EXPORTER_CLI_PATH = join(REPO_ROOT, 'packages', 'exporter-rpgm', 'src', 'cli.ts');

const require = createRequire(import.meta.url);

function resolveTsxCliPath(): string {
  const tsxPackageJsonPath = require.resolve('tsx/package.json');
  return join(dirname(tsxPackageJsonPath), 'dist', 'cli.mjs');
}

const UNSAFE_FOLDER_NAME_CHARS = /[^A-Za-z0-9_-]+/g;
const REPEATED_UNDERSCORES = /_+/g;

/** Sanitizes an arbitrary map name into a safe project folder name segment. Never returns an empty string. */
export function sanitizeProjectFolderName(name: string): string {
  const collapsed = name
    .replace(UNSAFE_FOLDER_NAME_CHARS, '_')
    .replace(REPEATED_UNDERSCORES, '_')
    .replace(/^_+|_+$/g, '');
  return collapsed.length > 0 ? collapsed : 'export';
}

export class DevExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevExportError';
  }
}

export interface RunDevExportOptions {
  readonly map: MapDocument;
  /** MZ blank-project template directory (real installs: `<engine>/newdata`). */
  readonly templateDir: string;
  readonly storeDir: string;
  /** Base directory exported projects are written under -- each export gets its own fresh, timestamped subfolder, always outside the repo. */
  readonly outBaseDir: string;
  /** Installed engine directory, used for the "cheaply detected" marker resolution path -- omit to always use the empirical fallback. */
  readonly engineDir?: string;
}

/**
 * Dev-only export entry point: resolves a fresh output folder under
 * `outBaseDir`, writes the map document to a temp file, and shells out to
 * `exporter-rpgm`'s CLI (via `tsx`) to do the actual copy/generate/write
 * work -- see this file's module doc for why it can't call `runExport`
 * in-process.
 */
export function runDevExport(options: RunDevExportOptions): ExportResult {
  const folderName = sanitizeProjectFolderName(options.map.name);
  const outDir = join(options.outBaseDir, `${folderName}-${Date.now()}`);

  const tmpDir = mkdtempSync(join(tmpdir(), 'threemaker-dev-export-'));
  const mapPath = join(tmpDir, 'map.tmmap.json');
  writeFileSync(mapPath, JSON.stringify(options.map));

  try {
    const args = [
      resolveTsxCliPath(),
      EXPORTER_CLI_PATH,
      mapPath,
      '--template',
      options.templateDir,
      '--out',
      outDir,
      '--store',
      options.storeDir,
      ...(options.engineDir ? ['--engine-dir', options.engineDir] : []),
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new DevExportError(
        `Export CLI failed (exit ${result.status ?? 'null'}): ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`,
      );
    }
    return JSON.parse(result.stdout) as ExportResult;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
