/**
 * Pure sha-extraction helper for `scripts/export-web-game.mjs` (C9 WU-01).
 * No filesystem — only the document walk that decides which asset-store
 * objects a playable static payload must include.
 */
import { describe, expect, it } from 'vitest';
import { extractAssetSha256Refs } from '../../../scripts/export-web-game.mjs';

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
