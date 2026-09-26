// Best-effort reader for RPG Maker MV/MZ's `System.json` player-start fields
// (`startMapId`/`startX`/`startY`), shared by the single-map `convert-rpgm`
// CLI command and the batch `convert-rpgm-game` command (rpgm-whole-game-import
// change) -- both need the same "which map/tile does a new game start on"
// lookup, previously duplicated inline in `cli.ts`'s
// `readPlayerStartIfStartMap`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripBom } from './strip-bom.js';

export interface RpgmSystemStart {
  readonly mapId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Reads `System.json`'s `startMapId`/`startX`/`startY`, searching the same
 * three candidate layouts `@threemaker/importer-rpgm`'s `loadProject` does
 * (`dir`, `dir/data`, `dir/www/data`). Fail-soft: returns `undefined` for a
 * missing file, malformed JSON, or a shape missing any of the three fields --
 * never throws, since a missing player-start is simply "no start map
 * override", not a conversion-blocking error.
 */
export function readRpgmSystemStart(gameDir: string): RpgmSystemStart | undefined {
  const candidates = [gameDir, join(gameDir, 'data'), join(gameDir, 'www', 'data')];
  for (const dir of candidates) {
    const systemPath = join(dir, 'System.json');
    if (!existsSync(systemPath)) continue;
    try {
      const system = JSON.parse(stripBom(readFileSync(systemPath, 'utf8'))) as {
        readonly startMapId?: unknown;
        readonly startX?: unknown;
        readonly startY?: unknown;
      };
      if (
        typeof system.startMapId === 'number' &&
        typeof system.startX === 'number' &&
        typeof system.startY === 'number'
      ) {
        return { mapId: system.startMapId, x: system.startX, y: system.startY };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
