/**
 * rpgm-to-v3-spike acceptance evidence: proves a `convertRpgmMap`-produced
 * document is accepted by the EXISTING authored-map load path
 * (`loadAuthoredMap` -> `translateMapDocument` -> per-slot texture
 * resolution), the same way a painter-authored `.tmmap` file already is.
 * Synthetic RpgmMap/tileset only -- see `SKILL.md`'s "committed tests use
 * synthetic fixtures" rule; the real-project run (kingdom-of-subversion) is
 * this change's manual acceptance evidence, not a committed asset.
 */

import type { RpgmMap, RpgmTileset, TileSheetNames } from '@threemaker/importer-rpgm';
import { convertRpgmMap } from '@threemaker/importer-rpgm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapDeps } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';

const EMPTY_SHEET_NAMES: TileSheetNames = {
  A1: '',
  A2: '',
  A3: '',
  A4: '',
  A5: '',
  B: '',
  C: '',
  D: '',
  E: '',
};

const WIDTH = 3;
const HEIGHT = 3;

/** 3x3 map: a wall tile (id 1) ringing the border, open ground (id 2) in the center. */
function buildSyntheticRpgmMap(): RpgmMap {
  const size = WIDTH * HEIGHT;
  const ground = new Array(size).fill(1);
  ground[4] = 2; // center tile (1,1): open ground
  return {
    id: 100,
    displayName: 'Synthetic Town Interior',
    width: WIDTH,
    height: HEIGHT,
    tilesetId: 1,
    scrollType: 0,
    layers: {
      tileLayers: [
        ground,
        new Array(size).fill(0),
        new Array(size).fill(0),
        new Array(size).fill(0),
      ],
      shadows: new Array(size).fill(0),
      regions: new Array(size).fill(0),
    },
  };
}

function buildSyntheticRpgmTileset(): RpgmTileset {
  const flags = new Array(8192).fill(0);
  flags[1] = 0xf; // wall: impassable in every direction
  // id 2 (ground) stays 0: fully passable
  return { id: 1, name: 'Synthetic Tileset', sheetNames: EMPTY_SHEET_NAMES, flags };
}

function buildDeps(rawText: string): AuthoredMapDeps {
  return {
    readMapDocumentText: vi.fn(async () => rawText),
    resolveObjectTexture: vi.fn(async () => {
      throw new Error(
        'resolveObjectTexture should not be called: converted doc has no sourced slots.',
      );
    }),
  };
}

describe('convertRpgmMap output accepted by the authored-map load path', () => {
  it('loads a converted RPGM map through loadAuthoredMap end to end', async () => {
    const rpgmMap = buildSyntheticRpgmMap();
    const rpgmTileset = buildSyntheticRpgmTileset();
    const doc = convertRpgmMap(rpgmMap, rpgmTileset, { id: 'rpgm-map-100' });
    const deps = buildDeps(JSON.stringify(doc));

    const result = await loadAuthoredMap(deps);

    expect(result).not.toBeNull();
    expect(result?.floorSources).toHaveLength(1);
    expect(result?.floorSources[0]?.floorId).toBe('floor-0');
    expect(result?.floorSources[0]?.baseElevation).toBe(0);
    expect(result?.floorSources[0]?.map.width).toBe(WIDTH);
    expect(result?.floorSources[0]?.map.height).toBe(HEIGHT);
    expect(result?.stairLinks).toEqual([]);
    // No sourced tileset slots in this spike (no catalog ingestion) --
    // fail-soft: every slot is simply skipped, not substituted with a
    // placeholder (that only happens for a slot whose object IS authored
    // but fails to resolve -- see authored-map.ts's W1 comment).
    expect(result?.floorSources[0]?.textures).toEqual({});
    expect(deps.resolveObjectTexture).not.toHaveBeenCalled();
  });

  it('omits spawn for a non-start map (spawn-quality bug fix): the desktop runtime picks one at load time instead', async () => {
    const rpgmMap = buildSyntheticRpgmMap();
    const rpgmTileset = buildSyntheticRpgmTileset();
    const doc = convertRpgmMap(rpgmMap, rpgmTileset, { id: 'rpgm-map-100' });
    const deps = buildDeps(JSON.stringify(doc));

    const result = await loadAuthoredMap(deps);

    // translateMapDocument's own spawn translation is `undefined` here --
    // `createMapSession`'s `resolveInitialSpawn` (apps/desktop/src/spawn.ts)
    // is what actually picks a spawn tile at session-build time, not this
    // load path; center tile (1,1), the only passable one on this synthetic
    // map, is still findable via that center-out search.
    expect(result?.spawn).toBeUndefined();
  });

  it('resolves spawn to an explicit RPGM player start when this map is the start map', async () => {
    const rpgmMap = buildSyntheticRpgmMap();
    const rpgmTileset = buildSyntheticRpgmTileset();
    const doc = convertRpgmMap(rpgmMap, rpgmTileset, {
      id: 'rpgm-map-100',
      playerStart: { x: 1, y: 1 },
    });
    const deps = buildDeps(JSON.stringify(doc));

    const result = await loadAuthoredMap(deps);

    expect(result?.spawn).toEqual({ x: 1, y: 1, floorIndex: 0 });
  });
});
