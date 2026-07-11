import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetRootForGame } from '../src/asset-root.js';

// Approval test for a gate-review dedup fix: `catalog.ts`'s `assetRootFor`
// and `tileset-ingest.ts`'s `assetRootForGameRow` were identical private
// functions (RPG Maker MV nests assets under `www/`; MZ does not) -- this
// pins the shared helper's behavior before both call sites are switched over.

describe('assetRootForGame', () => {
  it('nests an MV game root under www/', () => {
    const rootPath = join('C:', 'games', 'MyGame');
    expect(assetRootForGame({ engine: 'mv', rootPath })).toBe(join(rootPath, 'www'));
  });

  it('leaves an MZ game root unchanged', () => {
    const rootPath = join('C:', 'games', 'MyGame');
    expect(assetRootForGame({ engine: 'mz', rootPath })).toBe(rootPath);
  });
});
