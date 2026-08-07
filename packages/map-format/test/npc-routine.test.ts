/**
 * Additive optional `NpcDocument.routine` (C7 WU-01) — no format version
 * bump (MapSpawn precedent). Covers parse/round-trip, validation failures,
 * base-only tile uniqueness, and unchanged NPCs without a routine.
 */
import { describe, expect, it } from 'vitest';
import { parseMapDocument } from '../src/migrate.js';
import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  type MapLayers,
  serializeMapDocument,
} from '../src/schema.js';

const LAYER: readonly number[] = new Array(8 * 8).fill(0);
const LAYERS: MapLayers = { tiles: [LAYER, LAYER, LAYER, LAYER], shadows: LAYER, regions: LAYER };
const SHEET = 'a'.repeat(64);

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: 'routine-map',
    name: 'Routine Map',
    width: 8,
    height: 8,
    tileset: { slots: {}, flags: [0], semantics: {}, tilePixelSize: 48 },
    floors: [
      { id: 'floor-0', baseElevation: 0, layers: LAYERS },
      { id: 'floor-1', baseElevation: 3, layers: LAYERS },
    ],
    stairLinks: [],
    rooms: [],
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [],
    lights: [],
    ...overrides,
  };
}

function npc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'elder',
    x: 3,
    y: 4,
    floor: 'floor-0',
    facing: 'down',
    sprite: { object: SHEET, characterIndex: 1 },
    onInteract: 'elder-intro',
    ...overrides,
  };
}

const VALID_ROUTINE = [
  { at: 480, x: 5, y: 5, facing: 'right' },
  { at: 720, x: 1, y: 2, facing: 'up' },
] as const;

describe('NpcDocument.routine (additive, no version bump)', () => {
  it('parses a valid routine and round-trips through serialize', () => {
    const input = raw({ npcs: [npc({ routine: [...VALID_ROUTINE] })] });
    const parsed = parseMapDocument(input);
    expect(parsed.npcs[0]?.routine).toEqual([...VALID_ROUTINE]);
    expect(parseMapDocument(JSON.parse(serializeMapDocument(parsed)))).toEqual(parsed);
  });

  it('leaves an NPC without routine unchanged (field omitted)', () => {
    const parsed = parseMapDocument(raw({ npcs: [npc()] }));
    const elder = parsed.npcs[0];
    expect(elder).toEqual({
      id: 'elder',
      x: 3,
      y: 4,
      floor: 'floor-0',
      facing: 'down',
      sprite: { object: SHEET, characterIndex: 1 },
      onInteract: 'elder-intro',
    });
    expect(elder && 'routine' in elder).toBe(false);
  });

  it('allows two NPCs to share a ROUTINE stop tile while still enforcing base uniqueness', () => {
    const sharedStop = { at: 600, x: 4, y: 4, facing: 'down' };
    const ok = parseMapDocument(
      raw({
        npcs: [
          npc({ id: 'a', x: 0, y: 0, routine: [sharedStop] }),
          npc({ id: 'b', x: 1, y: 1, routine: [sharedStop] }),
        ],
      }),
    );
    expect(ok.npcs).toHaveLength(2);
    expect(ok.npcs[0]?.routine).toEqual([sharedStop]);
    expect(ok.npcs[1]?.routine).toEqual([sharedStop]);

    expect(() =>
      parseMapDocument(
        raw({
          npcs: [npc({ id: 'a', x: 2, y: 2 }), npc({ id: 'b', x: 2, y: 2 })],
        }),
      ),
    ).toThrow(/same tile/);
  });

  it('rejects an empty routine array', () => {
    expect(() => parseMapDocument(raw({ npcs: [npc({ routine: [] })] }))).toThrow(
      /"npcs\[0\]\.routine".*non-empty/,
    );
  });

  it('rejects unsorted routine entries and names indices', () => {
    expect(() =>
      parseMapDocument(
        raw({
          npcs: [
            npc({
              routine: [
                { at: 720, x: 1, y: 1, facing: 'down' },
                { at: 480, x: 2, y: 2, facing: 'up' },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/strictly ascending|routine\[0\].*routine\[1\]/);
  });

  it('rejects duplicate at values (not strictly ascending)', () => {
    expect(() =>
      parseMapDocument(
        raw({
          npcs: [
            npc({
              routine: [
                { at: 480, x: 1, y: 1, facing: 'down' },
                { at: 480, x: 2, y: 2, facing: 'up' },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/strictly ascending|routine\[0\].*routine\[1\]/);
  });

  it('rejects out-of-range at', () => {
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ routine: [{ at: 1440, x: 1, y: 1, facing: 'down' }] })] }),
      ),
    ).toThrow(/"npcs\[0\]\.routine\[0\]\.at".*\[0, 1440\)/);
    expect(() =>
      parseMapDocument(raw({ npcs: [npc({ routine: [{ at: -1, x: 1, y: 1, facing: 'down' }] })] })),
    ).toThrow(/"npcs\[0\]\.routine\[0\]\.at"/);
  });

  it('rejects out-of-range routine coords', () => {
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ routine: [{ at: 100, x: 99, y: 1, facing: 'down' }] })] }),
      ),
    ).toThrow(/"npcs\[0\]\.routine\[0\]\.x"/);
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ routine: [{ at: 100, x: 1, y: -1, facing: 'down' }] })] }),
      ),
    ).toThrow(/"npcs\[0\]\.routine\[0\]\.y"/);
  });

  it('rejects bad facing on a routine stop', () => {
    expect(() =>
      parseMapDocument(
        raw({ npcs: [npc({ routine: [{ at: 100, x: 1, y: 1, facing: 'north' }] })] }),
      ),
    ).toThrow(/"npcs\[0\]\.routine\[0\]\.facing".*north/);
  });
});
