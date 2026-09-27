import {
  CURRENT_MAP_FORMAT_VERSION,
  MAP_FORMAT_MAGIC,
  parseMapDocument,
  serializeMapDocument,
  validateCurrentVersionShape,
} from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { type ConvertRpgmMapOptions, convertRpgmMap } from '../src/convert-rpgm-map.js';
import type {
  RpgmEvent,
  RpgmEventCommand,
  RpgmEventPage,
  RpgmMap,
  RpgmTileset,
  TileSheetNames,
} from '../src/types.js';

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

/** 3x2 by default: tile id 1 on layer 0 everywhere except (0,0), which stays empty (id 0). */
function buildSyntheticMap(overrides: Partial<RpgmMap> = {}): RpgmMap {
  const width = overrides.width ?? 3;
  const height = overrides.height ?? 2;
  const size = width * height;
  const ground = new Array(size).fill(1);
  ground[0] = 0; // (0,0) left empty on purpose
  return {
    id: 100,
    displayName: 'Synthetic Map',
    width,
    height,
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
    ...overrides,
  };
}

const CLEAR_CONDITIONS: RpgmEventPage['conditions'] = {
  actorValid: false,
  itemValid: false,
  selfSwitchValid: false,
  switch1Valid: false,
  switch2Valid: false,
  variableValid: false,
};

function showTextPage(
  trigger: number,
  lines: readonly string[],
  speaker?: string,
  conditions: RpgmEventPage['conditions'] = CLEAR_CONDITIONS,
  extra: readonly RpgmEventCommand[] = [],
): RpgmEventPage {
  const header: RpgmEventCommand = {
    code: 101,
    indent: 0,
    parameters: speaker === undefined ? [] : ['', 0, 0, 2, speaker],
  };
  const body: RpgmEventCommand[] = lines.map((line) => ({
    code: 401,
    indent: 0,
    parameters: [line],
  }));
  return {
    conditions,
    trigger,
    list: [header, ...body, ...extra, { code: 0, indent: 0, parameters: [] }],
  };
}

function placedEvent(page: RpgmEventPage, pages: readonly RpgmEventPage[] = [page]): RpgmEvent {
  return { id: 1, name: 'Elder', x: 2, y: 3, pages };
}

function buildSyntheticTileset(overrides: Partial<RpgmTileset> = {}): RpgmTileset {
  const flags = new Array(8192).fill(0);
  // Tile id 1: fully impassable in every direction (wall).
  flags[1] = 0xf;
  return {
    id: 1,
    name: 'Synthetic Tileset',
    sheetNames: EMPTY_SHEET_NAMES,
    flags,
    ...overrides,
  };
}

describe('convertRpgmMap', () => {
  it('maps tile/shadow/region layers 1:1 into a single floor at baseElevation 0', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.format).toBe(MAP_FORMAT_MAGIC);
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.width).toBe(3);
    expect(doc.height).toBe(2);
    expect(doc.floors).toHaveLength(1);
    expect(doc.floors[0]?.baseElevation).toBe(0);
    expect(doc.floors[0]?.layers.tiles).toEqual(map.layers.tileLayers);
    expect(doc.floors[0]?.layers.shadows).toEqual(map.layers.shadows);
    expect(doc.floors[0]?.layers.regions).toEqual(map.layers.regions);
    expect(doc.stairLinks).toEqual([]);
    expect(doc.rooms).toEqual([]);
  });

  it('carries the RPGM tileset flags through unchanged', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.tileset.flags).toEqual(tileset.flags);
    expect(doc.tileset.slots).toEqual({});
    expect(doc.tileset.semantics).toEqual({});
  });

  it('derives an id from the RPGM numeric map id when none is given', () => {
    const map = buildSyntheticMap({ id: 42 });
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.id).toBe('rpgm-map-42');
  });

  it('honors an explicit id override', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset, { id: 'custom-id' });

    expect(doc.id).toBe('custom-id');
  });

  it('uses the given player start as spawn when this map is the RPGM start map', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset, { playerStart: { x: 2, y: 1 } });

    expect(doc.spawn).toEqual({ x: 2, y: 1, floor: 'floor-0' });
  });

  it('omits spawn entirely when no player start is given, even on a map with standable tiles (spawn-quality bug fix: let the desktop runtime pick)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    // (0,0) is standable here (every other cell has the wall tile, id 1),
    // but this converter no longer synthesizes a spawn for a non-start map
    // at all -- `apps/desktop/src/spawn.ts`'s `resolveInitialSpawn` ->
    // `findSpawnTile` center-out search (which also applies the
    // strengthened "has a usable exit" predicate) picks a better position
    // at load time instead of trusting a row-major first-standable-tile
    // scan that has no way to know if that tile is enclosed/reachable.
    const doc = convertRpgmMap(map, tileset);

    expect(doc.spawn).toBeUndefined();
  });

  it('produces a document that passes full schema validation', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(() => validateCurrentVersionShape(doc)).not.toThrow();
  });

  it('emits empty v4 narrative ports (npcs/triggers/events/worldSeeds) at CURRENT_MAP_FORMAT_VERSION', () => {
    const doc = convertRpgmMap(buildSyntheticMap(), buildSyntheticTileset());

    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.npcs).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
    expect(doc.worldSeeds).toEqual({});
  });

  it('passes given tileset slots through verbatim (catalog lookup is the caller job, not this pure converters)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();
    const slots = {
      A1: { object: 'abc123', sourceTilesetId: 7, sourceGameId: 1 },
    };

    const doc = convertRpgmMap(map, tileset, { slots });

    expect(doc.tileset.slots).toEqual(slots);
  });

  it('defaults slots to an empty object when none are given (unchanged spike behavior)', () => {
    const map = buildSyntheticMap();
    const tileset = buildSyntheticTileset();

    const doc = convertRpgmMap(map, tileset);

    expect(doc.tileset.slots).toEqual({});
  });

  it('imports an unconditional action-button Show Text page as an interact trigger', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [null, placedEvent(showTextPage(0, ['Hello', 'Traveler'], 'Elder'))],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([
      {
        id: 'rpgm-event-1',
        x: 2,
        y: 3,
        floor: 'floor-0',
        on: 'interact',
        event: 'rpgm-event-1',
      },
    ]);
    expect(doc.events['rpgm-event-1']).toEqual([
      {
        type: 'showDialogue',
        speaker: 'Elder',
        source: { kind: 'text', lines: ['Hello', 'Traveler'] },
      },
    ]);

    const roundTrip = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
    expect(roundTrip.triggers).toEqual(doc.triggers);
    expect(roundTrip.events).toEqual(doc.events);
    expect(() => validateCurrentVersionShape(doc)).not.toThrow();
  });

  it('maps a player-touch Show Text page to an enter trigger', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [placedEvent(showTextPage(1, ['Hello'], 'Elder'))],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([
      {
        id: 'rpgm-event-1',
        x: 2,
        y: 3,
        floor: 'floor-0',
        on: 'enter',
        event: 'rpgm-event-1',
      },
    ]);
  });

  describe('Transfer Player and author comments', () => {
    function convertPage(list: readonly RpgmEventCommand[], opts: ConvertRpgmMapOptions = {}) {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [placedEvent({ conditions: CLEAR_CONDITIONS, trigger: 1, list })],
        }),
        buildSyntheticTileset(),
        opts,
      );
      const roundTrip = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
      expect(roundTrip.triggers).toEqual(doc.triggers);
      expect(roundTrip.events).toEqual(doc.events);
      return doc;
    }

    const end: RpgmEventCommand = { code: 0, indent: 0, parameters: [] };
    const transfer: RpgmEventCommand = {
      code: 201,
      indent: 0,
      parameters: [0, 2, 1, 2, 6, 0],
    };
    const comments: readonly RpgmEventCommand[] = [
      { code: 108, indent: 0, parameters: ['Author note'] },
      { code: 408, indent: 0, parameters: ['Continuation note'] },
    ];

    it('imports a touch-triggered Transfer Player with the default black fade', () => {
      const doc = convertPage([transfer, end]);

      expect(doc.triggers).toEqual([
        {
          id: 'rpgm-event-1',
          x: 2,
          y: 3,
          floor: 'floor-0',
          on: 'enter',
          event: 'rpgm-event-1',
        },
      ]);
      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'transferMap', mapFile: 'map002.tmmap.json', x: 1, y: 2, facing: 'right' },
      ]);
    });

    it('preserves Show Text before a terminal transfer', () => {
      const doc = convertPage(
        showTextPage(1, ['Through this door.'], 'Guide', CLEAR_CONDITIONS, [transfer]).list,
      );

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'showDialogue',
          speaker: 'Guide',
          source: { kind: 'text', lines: ['Through this door.'] },
        },
        { type: 'transferMap', mapFile: 'map002.tmmap.json', x: 1, y: 2, facing: 'right' },
      ]);
    });

    it('omits facing for direction zero and uses a custom transfer filename', () => {
      const doc = convertPage([{ ...transfer, parameters: [0, 12, 0, 0, 0, 0] }, end], {
        transferMapFile: (mapId) => `destination-${mapId}.tmmap.json`,
      });

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'transferMap', mapFile: 'destination-12.tmmap.json', x: 0, y: 0 },
      ]);
      expect(doc.events['rpgm-event-1']?.[0]).not.toHaveProperty('facing');
    });

    it.each([
      [2, 'down'],
      [4, 'left'],
      [6, 'right'],
      [8, 'up'],
    ])('maps direction %i to %s', (direction, facing) => {
      const doc = convertPage([{ ...transfer, parameters: [0, 2, 1, 2, direction, 0] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'transferMap', mapFile: 'map002.tmmap.json', x: 1, y: 2, facing },
      ]);
    });

    it.each([1, 2])('ignores fade type %i', (fadeType) => {
      const doc = convertPage([{ ...transfer, parameters: [0, 2, 1, 2, 6, fadeType] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'transferMap', mapFile: 'map002.tmmap.json', x: 1, y: 2, facing: 'right' },
      ]);
    });

    it.each([
      ['variable designation', [1, 2, 1, 2, 6, 0]],
      ['unknown designation', [2, 2, 1, 2, 6, 0]],
      ['zero map id', [0, 0, 1, 2, 6, 0]],
      ['negative map id', [0, -1, 1, 2, 6, 0]],
      ['fractional map id', [0, 1.5, 1, 2, 6, 0]],
      ['string map id', [0, '2', 1, 2, 6, 0]],
      ['fractional x', [0, 2, 1.5, 2, 6, 0]],
      ['negative x', [0, 2, -1, 2, 6, 0]],
      ['string x', [0, 2, '1', 2, 6, 0]],
      ['fractional y', [0, 2, 1, 2.5, 6, 0]],
      ['negative y', [0, 2, 1, -1, 6, 0]],
      ['string y', [0, 2, 1, '2', 6, 0]],
      ['invalid direction', [0, 2, 1, 2, 3, 0]],
      ['string direction', [0, 2, 1, 2, '6', 0]],
      ['missing direction', [0, 2, 1, 2]],
    ])('rejects a page containing a transfer with %s', (_label, parameters) => {
      const doc = convertPage(
        showTextPage(1, ['This whole page must be rejected.'], undefined, CLEAR_CONDITIONS, [
          { ...transfer, parameters },
        ]).list,
      );

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it.each([101, 401, 201, 355])('rejects executable command %i after a transfer', (code) => {
      const doc = convertPage([transfer, end, ...comments, { ...transfer, code }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('ignores author comments before and between dialogue blocks', () => {
      const first = showTextPage(1, ['Hello'], 'Guide').list;
      const second = showTextPage(1, ['Welcome'], 'Host').list;
      const plain = convertPage([...first, ...second]);
      const annotated = convertPage([...comments, ...first, ...comments, ...second]);

      expect(plain.events['rpgm-event-1']).toHaveLength(2);
      expect(annotated.triggers).toEqual(plain.triggers);
      expect(annotated.events).toEqual(plain.events);
    });

    it('allows comments and terminators after a terminal transfer', () => {
      const plain = convertPage([transfer, end]);
      const annotated = convertPage([...comments, transfer, end, ...comments, end]);

      expect(annotated.triggers).toEqual(plain.triggers);
      expect(annotated.events).toEqual(plain.events);
    });

    it('emits no trigger for a comment-only page', () => {
      const doc = convertPage([...comments, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });
  });

  describe('Show Scrolling Text and switch/variable assignments', () => {
    function convertList(list: readonly RpgmEventCommand[]) {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [placedEvent({ conditions: CLEAR_CONDITIONS, trigger: 0, list })],
        }),
        buildSyntheticTileset(),
      );
      const roundTrip = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
      expect(roundTrip.triggers).toEqual(doc.triggers);
      expect(roundTrip.events).toEqual(doc.events);
      return doc;
    }

    const end: RpgmEventCommand = { code: 0, indent: 0, parameters: [] };

    it('imports a 105 scrolling-text block and its 405 lines as one speakerless showDialogue', () => {
      const doc = convertList([
        { code: 105, indent: 0, parameters: [2, false] },
        { code: 405, indent: 0, parameters: ['The rain falls.'] },
        { code: 405, indent: 0, parameters: ['The road is empty.'] },
        end,
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'showDialogue',
          source: { kind: 'text', lines: ['The rain falls.', 'The road is empty.'] },
        },
      ]);
    });

    it('preserves Show Text, then switches 121, then a constant variable set 122', () => {
      const doc = convertList([
        ...showTextPage(0, ['Hello'], 'Elder').list,
        { code: 121, indent: 0, parameters: [1, 2, 0] },
        { code: 122, indent: 0, parameters: [5, 5, 0, 0, 42] },
        end,
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'showDialogue',
          speaker: 'Elder',
          source: { kind: 'text', lines: ['Hello'] },
        },
        { type: 'setWorldVar', key: 'rpgm.switch.1', value: true },
        { type: 'setWorldVar', key: 'rpgm.switch.2', value: true },
        { type: 'setWorldVar', key: 'rpgm.variable.5', value: 42 },
      ]);
    });

    it('imports switch 121 OFF (value 1) as false', () => {
      const doc = convertList([{ code: 121, indent: 0, parameters: [1, 1, 1] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'setWorldVar', key: 'rpgm.switch.1', value: false },
      ]);
    });

    it('rejects variable 122 operationType 1 (add)', () => {
      const doc = convertList([{ code: 122, indent: 0, parameters: [5, 5, 1, 0, 1] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('rejects variable 122 operandType 1 (variable)', () => {
      const doc = convertList([{ code: 122, indent: 0, parameters: [5, 5, 0, 1, 1] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('rejects switch 121 when the id range contains 101 ids', () => {
      const doc = convertList([{ code: 121, indent: 0, parameters: [1, 101, 0] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('rejects switch 121 after a terminal transfer 201', () => {
      const doc = convertList([
        { code: 201, indent: 0, parameters: [0, 2, 1, 2, 6, 0] },
        { code: 121, indent: 0, parameters: [1, 1, 0] },
        end,
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });
  });

  it('skips an event whose page contains an unsupported command', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [
          placedEvent(
            showTextPage(0, ['Hello'], 'Elder', CLEAR_CONDITIONS, [
              { code: 355, indent: 0, parameters: ['unsupportedScript()'] },
            ]),
          ),
        ],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an event whose last page is conditional even when an earlier page is pure text', () => {
    const text = showTextPage(0, ['Hello'], 'Elder');
    const conditional = showTextPage(0, ['Hello'], 'Elder', {
      ...CLEAR_CONDITIONS,
      switch1Valid: true,
    });
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [placedEvent(conditional, [text, conditional])],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips autorun Show Text pages', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [placedEvent(showTextPage(3, ['Hello'], 'Elder'))],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('emits empty ports for null event slots and for a map with no events', () => {
    const tileset = buildSyntheticTileset();
    const withNulls = convertRpgmMap(buildSyntheticMap({ events: [null, null] }), tileset);
    expect(withNulls.triggers).toEqual([]);
    expect(withNulls.events).toEqual({});

    const without = convertRpgmMap(buildSyntheticMap(), tileset);
    expect(without.triggers).toEqual([]);
    expect(without.events).toEqual({});
  });
});
