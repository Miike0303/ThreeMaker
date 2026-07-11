#!/usr/bin/env -S node --experimental-strip-types
// CLI: exports a `.tmmap.json` map document to a real RPG Maker MZ project
// folder. Node-only entry point (not part of the package's public exports),
// run via `tsx` (see the package's `export` script) -- mirrors
// `packages/assets/src/cli.ts`'s shape.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseMapDocument } from '@threemaker/map-format';
import { findInstalledMarkerVersion, runExport } from './node.js';

const DEFAULT_STORE_DIR = join(homedir(), '.threemaker', 'asset-store');

function printUsage(): void {
  console.error(
    'Usage: tsx src/cli.ts <map.tmmap.json> --template <mzTemplateDir> --out <outDir> [--store <storeDir>] [--engine-dir <installedEngineDir>]',
  );
}

interface Args {
  readonly mapPath: string;
  readonly templateDir: string;
  readonly outDir: string;
  readonly storeDir: string;
  readonly engineDir?: string;
}

function parseArgs(argv: readonly string[]): Args | null {
  const [mapPath, ...rest] = argv;
  if (!mapPath) return null;

  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index === -1 ? undefined : rest[index + 1];
  };

  const templateDir = flag('--template');
  const outDir = flag('--out');
  if (!templateDir || !outDir) return null;

  const engineDir = flag('--engine-dir');

  return {
    mapPath,
    templateDir,
    outDir,
    storeDir: flag('--store') ?? DEFAULT_STORE_DIR,
    ...(engineDir === undefined ? {} : { engineDir }),
  };
}

function main(argv: readonly string[]): void {
  const parsed = parseArgs(argv);
  if (!parsed) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const mapJson = JSON.parse(readFileSync(parsed.mapPath, 'utf8'));
  const map = parseMapDocument(mapJson);

  const markerVersion = parsed.engineDir ? findInstalledMarkerVersion(parsed.engineDir) : null;

  const result = runExport({
    templateDir: parsed.templateDir,
    outDir: parsed.outDir,
    storeDir: parsed.storeDir,
    map,
    markerVersion,
  });

  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2));
