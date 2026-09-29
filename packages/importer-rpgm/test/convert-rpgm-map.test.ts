// biome-ignore-all lint/suspicious/noThenProperty: EventCommand requires the schema field named "then".
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
  it('skips a transfer with a negative designation mode', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 201, indent: 0, parameters: [-1, 2, 1, 2, 6, 0] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('preserves a one-character Show Text speaker', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [placedEvent(showTextPage(0, ['Hello'], 'A'))],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.events['rpgm-event-1']).toEqual([
      { type: 'showDialogue', speaker: 'A', source: { kind: 'text', lines: ['Hello'] } },
    ]);
  });

  it('skips a variable assignment with a negative operation mode', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 122, indent: 0, parameters: [5, 5, -1, 0, 42] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips a variable assignment with a negative operand mode', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 122, indent: 0, parameters: [5, 5, 0, -1, 42] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an item change with an unsafe integer item ID', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 126, indent: 0, parameters: [Number.MAX_SAFE_INTEGER + 1, 0, 0, 1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an item change with an unsafe integer quantity', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 126, indent: 0, parameters: [7, 0, 0, Number.MAX_SAFE_INTEGER + 1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an item change with a negative operation mode', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 126, indent: 0, parameters: [7, -1, 0, 1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips a self-switch command with a negative ON/OFF value', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 123, indent: 0, parameters: ['A', -1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an event with a fractional event ID', () => {
    const event = { ...placedEvent(showTextPage(0, ['Hello'])), id: 1.5 };
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [event] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips an event with a fractional tile coordinate', () => {
    const event = { ...placedEvent(showTextPage(0, ['Hello'])), x: 1.5 };
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [event] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('imports dialogue after an orphan text continuation', () => {
    const page = showTextPage(0, ['Hello']);
    const event = placedEvent({
      ...page,
      list: [{ code: 401, indent: 0, parameters: ['Orphan'] }, ...page.list],
    });
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [event] }),
      buildSyntheticTileset(),
    );

    expect(doc.events['rpgm-event-1']).toEqual([
      { type: 'showDialogue', source: { kind: 'text', lines: ['Hello'] } },
    ]);
  });

  it('skips a switch assignment with a fractional end ID', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 121, indent: 0, parameters: [1, 1.5, 0] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips a switch assignment with a negative ON/OFF value', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 121, indent: 0, parameters: [1, 1, -1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips a variable assignment with an unsafe integer constant', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 122, indent: 0, parameters: [1, 1, 0, 0, Number.MAX_SAFE_INTEGER + 1] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('skips weapon changes with a non-boolean include-equipment flag', () => {
    const page = showTextPage(0, ['Before'], undefined, CLEAR_CONDITIONS, [
      { code: 127, indent: 0, parameters: [7, 0, 0, 2, 'true'] },
    ]);
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('omits the speaker property for an empty Show Text speaker', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [placedEvent(showTextPage(0, ['Hello'], ''))],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.events['rpgm-event-1']).toEqual([
      { type: 'showDialogue', source: { kind: 'text', lines: ['Hello'] } },
    ]);
  });

  it('preserves region IDs when shadow masks differ', () => {
    const map = buildSyntheticMap();
    const regions = [0, 1, 2, 3, 4, 7];
    const doc = convertRpgmMap(
      { ...map, layers: { ...map.layers, regions, shadows: [8, 9, 10, 11, 12, 13] } },
      buildSyntheticTileset(),
    );

    expect(doc.floors[0]?.layers.regions).toEqual(regions);
  });

  it('preserves a zero numeric map ID in the document ID', () => {
    const doc = convertRpgmMap(buildSyntheticMap({ id: 0 }), buildSyntheticTileset());
    expect(doc.id).toBe('rpgm-map-0');
  });

  it('rejects an event at the width boundary of a taller map', () => {
    const event = { ...placedEvent(showTextPage(0, ['Outside the map'])), x: 2, y: 1 };
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 2, height: 4, events: [event] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
  });

  it('preserves shadow masks when region IDs differ', () => {
    const map = buildSyntheticMap();
    const shadows = [1, 2, 3, 4, 5, 6];
    const doc = convertRpgmMap(
      {
        ...map,
        layers: { ...map.layers, shadows, regions: [10, 11, 12, 13, 14, 15] },
      },
      buildSyntheticTileset(),
    );

    expect(doc.floors[0]?.layers.shadows).toEqual(shadows);
  });

  it('keeps the RPG Maker tile size at 48 pixels', () => {
    const doc = convertRpgmMap(buildSyntheticMap(), buildSyntheticTileset());
    expect(doc.tileset.tilePixelSize).toBe(48);
  });

  it('imports an event below the width boundary on a taller map', () => {
    const event = { ...placedEvent(showTextPage(0, ['Hello'])), x: 1, y: 3 };
    const doc = convertRpgmMap(
      buildSyntheticMap({ width: 2, height: 4, events: [event] }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([
      { id: 'rpgm-event-1', x: 1, y: 3, floor: 'floor-0', on: 'interact', event: 'rpgm-event-1' },
    ]);
  });

  it('skips a negative event trigger mode', () => {
    const event = { ...placedEvent(showTextPage(-1, ['Hello'])), x: 1, y: 1 };
    const doc = convertRpgmMap(buildSyntheticMap({ events: [event] }), buildSyntheticTileset());
    expect(doc.triggers).toEqual([]);
  });

  it('skips an event placed at the exclusive map width boundary', () => {
    const event = { ...placedEvent(showTextPage(0, ['Hello'])), x: 3, y: 1 };
    const doc = convertRpgmMap(buildSyntheticMap({ events: [event] }), buildSyntheticTileset());
    expect(doc.triggers).toEqual([]);
  });

  it('skips an event page with a negative command code', () => {
    const page = showTextPage(0, ['Hello'], undefined, CLEAR_CONDITIONS, [
      { code: -1, indent: 0, parameters: [] },
    ]);
    const event = { ...placedEvent(page), x: 1, y: 1 };
    const doc = convertRpgmMap(buildSyntheticMap({ events: [event] }), buildSyntheticTileset());
    expect(doc.triggers).toEqual([]);
  });

  it.each([
    ['', 'Town', 'Town'],
    ['Harbor', 'Town', 'Harbor'],
    ['', undefined, ''],
  ])('chooses document name from display/editor name (%s, %s)', (displayName, editorName, name) => {
    const map = buildSyntheticMap({ displayName, editorName });

    const doc = convertRpgmMap(map, buildSyntheticTileset());

    expect(doc.name).toBe(name);
  });

  it('mutation pin: keeps a one-character display name over the editor name', () => {
    const map = buildSyntheticMap({ displayName: 'A', editorName: 'Town' });
    expect(convertRpgmMap(map, buildSyntheticTileset()).name).toBe('A');
  });

  it('uses the editor name when the display name contains only spaces', () => {
    const map = buildSyntheticMap({ displayName: '   ', editorName: 'Town' });
    expect(convertRpgmMap(map, buildSyntheticTileset()).name).toBe('Town');
  });

  it('uses an empty document name when the editor name contains only spaces', () => {
    const map = buildSyntheticMap({ displayName: '', editorName: '   ' });
    expect(convertRpgmMap(map, buildSyntheticTileset()).name).toBe('');
  });

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

  it('uses an unknown-map id when the RPGM map has no numeric id', () => {
    const doc = convertRpgmMap(buildSyntheticMap({ id: null }), buildSyntheticTileset());

    expect(doc.id).toBe('rpgm-map-unknown');
  });

  it('preserves an explicitly empty document ID instead of generating a replacement', () => {
    const doc = convertRpgmMap(buildSyntheticMap(), buildSyntheticTileset(), { id: '' });

    expect(doc.id).toBe('');
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

  it('initializes imported maps with an empty props list', () => {
    const doc = convertRpgmMap(buildSyntheticMap(), buildSyntheticTileset());

    expect(doc.props).toEqual([]);
  });

  it('initializes imported maps with an empty lights list', () => {
    const doc = convertRpgmMap(buildSyntheticMap(), buildSyntheticTileset());

    expect(doc.lights).toEqual([]);
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

  it('imports an event placed at the top-left map coordinate', () => {
    const doc = convertRpgmMap(
      buildSyntheticMap({
        width: 4,
        height: 4,
        events: [
          {
            ...placedEvent(showTextPage(1, ['At the edge'])),
            x: 0,
            y: 0,
          },
        ],
      }),
      buildSyntheticTileset(),
    );

    expect(doc.triggers).toEqual([
      {
        id: 'rpgm-event-1',
        x: 0,
        y: 0,
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

    it('skips a transfer with a string downward direction', () => {
      const doc = convertPage([{ ...transfer, parameters: [0, 2, 1, 2, '2', 0] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('imports a transfer to map 1', () => {
      const doc = convertPage([{ ...transfer, parameters: [0, 1, 0, 0, 2, 0] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'transferMap', mapFile: 'map001.tmmap.json', x: 0, y: 0, facing: 'down' },
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

  describe('Show Scrolling Text, assignments, and item changes', () => {
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

    it('imports exactly 100 switch ids from one command', () => {
      const doc = convertList([{ code: 121, indent: 0, parameters: [1, 100, 0] }, end]);
      const commands = doc.events['rpgm-event-1'];

      expect(commands).toHaveLength(100);
      expect(commands?.[0]).toEqual({ type: 'setWorldVar', key: 'rpgm.switch.1', value: true });
      expect(commands?.[99]).toEqual({ type: 'setWorldVar', key: 'rpgm.switch.100', value: true });
    });

    it('skips an item change with a negative operand mode', () => {
      const doc = convertList([{ code: 126, indent: 0, parameters: [7, 0, -1, 2] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('skips a weapon change with a sixth parameter', () => {
      const doc = convertList([{ code: 127, indent: 0, parameters: [7, 0, 0, 2, true, 0] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('skips the whole event when a switch range runs backwards', () => {
      const doc = convertList([
        ...showTextPage(0, ['Before']).list,
        { code: 121, indent: 0, parameters: [2, 1, 0] },
        end,
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('omits an empty scrolling block before a switch assignment', () => {
      const doc = convertList([
        { code: 105, indent: 0, parameters: [2, false] },
        { code: 121, indent: 0, parameters: [1, 1, 0] },
        end,
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'setWorldVar', key: 'rpgm.switch.1', value: true },
      ]);
    });

    it('skips the whole event when a dialogue line is not a string', () => {
      const doc = convertList([
        ...showTextPage(0, ['Before']).list,
        { code: 401, indent: 0, parameters: [17] },
        end,
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('imports Change Items 126 increases as giveItem', () => {
      const doc = convertList([{ code: 126, indent: 0, parameters: [7, 0, 0, 1] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'giveItem', itemId: 'rpgm.item.7', amount: 1 },
      ]);
    });

    it('imports Change Items 126 decreases as negative giveItem amounts', () => {
      const doc = convertList([{ code: 126, indent: 0, parameters: [7, 1, 0, 3] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'giveItem', itemId: 'rpgm.item.7', amount: -3 },
      ]);
    });

    it('imports Change Weapons 127 increases as weapon inventory', () => {
      const doc = convertList([{ code: 127, indent: 0, parameters: [7, 0, 0, 2, true] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'giveItem', itemId: 'rpgm.weapon.7', amount: 2 },
      ]);
    });

    it('imports Change Armors 128 decreases as negative armor inventory', () => {
      const doc = convertList([{ code: 128, indent: 0, parameters: [4, 1, 0, 3] }, end]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'giveItem', itemId: 'rpgm.armor.4', amount: -3 },
      ]);
    });

    it('skips Change Weapons 127 with a variable operand', () => {
      const doc = convertList([{ code: 127, indent: 0, parameters: [7, 0, 1, 2, false] }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('preserves Show Text before and after Change Items 126', () => {
      const doc = convertList([
        ...showTextPage(0, ['Before']).list,
        { code: 126, indent: 0, parameters: [7, 0, 0, 1] },
        ...showTextPage(0, ['After']).list,
        end,
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'showDialogue', source: { kind: 'text', lines: ['Before'] } },
        { type: 'giveItem', itemId: 'rpgm.item.7', amount: 1 },
        { type: 'showDialogue', source: { kind: 'text', lines: ['After'] } },
      ]);
    });

    it.each([
      [7, 0, 1, 5],
      [7, 0, 0, 0],
      [7, 0, 0, -1],
      [7, 0, 0, 1.5],
      [0, 0, 0, 1],
      [7.5, 0, 0, 1],
      [7, 2, 0, 1],
      [7, 0, 0],
      [7, 0, 0, 1, 2],
    ])('skips Change Items 126 with invalid parameters %j', (...parameters) => {
      const doc = convertList([{ code: 126, indent: 0, parameters }, end]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
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

  describe('switch-conditioned event pages', () => {
    function convertPages(pages: readonly RpgmEventPage[]) {
      const first = pages[0];
      if (first === undefined) throw new Error('Expected at least one event page');
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [placedEvent(first, pages)],
        }),
        buildSyntheticTileset(),
      );
      const roundTrip = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
      expect(roundTrip.triggers).toEqual(doc.triggers);
      expect(roundTrip.events).toEqual(doc.events);
      return doc;
    }

    const dialogue = (line: string) => ({
      type: 'showDialogue',
      source: { kind: 'text', lines: [line] },
    });

    it('uses the highest matching switch page and falls back to the first page', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        showTextPage(0, ['Welcome back'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 3,
        }),
      ]);

      expect(doc.triggers).toHaveLength(1);
      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.switch.3', op: 'eq', value: true },
          then: [dialogue('Welcome back')],
          else: [dialogue('Hello')],
        },
      ]);
    });

    it('skips an item-gated page with a numeric activation flag', () => {
      const conditions = JSON.parse('{"itemValid":1,"itemId":7}');
      const doc = convertPages([showTextPage(0, ['Locked'], undefined, conditions)]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('selects an item-gated page over an unconditional fallback', () => {
      const doc = convertPages([
        showTextPage(0, ['No key']),
        showTextPage(0, ['You have the key'], undefined, {
          ...CLEAR_CONDITIONS,
          itemValid: true,
          itemId: 7,
        }),
      ]);

      expect(doc.triggers).toHaveLength(1);
      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.item.7', op: 'gt', value: 0, source: 'item' },
          then: [dialogue('You have the key')],
          else: [dialogue('No key')],
        },
      ]);
    });

    it('nests item conditions after switches and the self switch', () => {
      const doc = convertPages([
        showTextPage(0, ['Fallback']),
        showTextPage(0, ['Matched'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
          switch2Valid: true,
          switch2Id: 2,
          selfSwitchValid: true,
          selfSwitchCh: 'A',
          itemValid: true,
          itemId: 7,
        }),
      ]);

      const switch1 = doc.events['rpgm-event-1']?.[0];
      expect(switch1?.type).toBe('conditional');
      expect(switch1?.if).toEqual({ key: 'rpgm.switch.1', op: 'eq', value: true });
      const switch2 = switch1?.then?.[0];
      expect(switch2?.if).toEqual({ key: 'rpgm.switch.2', op: 'eq', value: true });
      const selfSwitch = switch2?.then?.[0];
      expect(selfSwitch?.if).toEqual({ key: 'rpgm.self.100.1.A', op: 'eq', value: true });
      const item = selfSwitch?.then?.[0];
      expect(item?.if).toEqual({ key: 'rpgm.item.7', op: 'gt', value: 0, source: 'item' });
      expect(item?.then).toEqual([dialogue('Matched')]);
      expect(item?.else).toEqual([dialogue('Fallback')]);
    });

    it('omits the fallback when only a conditional page exists', () => {
      const doc = convertPages([
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
        }),
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.switch.1', op: 'eq', value: true },
          then: [dialogue('Welcome')],
        },
      ]);
    });

    it('lets an empty matching page suppress commands from lower pages', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        {
          conditions: { ...CLEAR_CONDITIONS, switch1Valid: true, switch1Id: 1 },
          trigger: 0,
          list: [{ code: 0, indent: 0, parameters: [] }],
        },
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.switch.1', op: 'eq', value: true },
          then: [],
          else: [dialogue('Hello')],
        },
      ]);
    });

    it('requires both switches on a two-switch page', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
          switch2Valid: true,
          switch2Id: 2,
        }),
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.switch.1', op: 'eq', value: true },
          then: [
            {
              type: 'conditional',
              if: { key: 'rpgm.switch.2', op: 'eq', value: true },
              then: [dialogue('Welcome')],
              else: [dialogue('Hello')],
            },
          ],
          else: [dialogue('Hello')],
        },
      ]);
    });

    it('skips the event when any page has an unsupported condition', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          variableValid: true,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it.each([undefined, 0, 1.5])('skips an active switch without a valid id (%s)', (id) => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: id,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it.each([undefined, 0, 1.5])('skips an active item condition without a valid id (%s)', (id) => {
      const doc = convertPages([
        showTextPage(0, ['Fallback']),
        showTextPage(0, ['Matched'], undefined, {
          ...CLEAR_CONDITIONS,
          itemValid: true,
          itemId: id,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('skips the event when page trigger kinds differ', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello']),
        showTextPage(1, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('skips the event when a reachable page contains an unsupported command', () => {
      const doc = convertPages([
        showTextPage(0, ['Hello'], undefined, CLEAR_CONDITIONS, [
          { code: 355, indent: 0, parameters: ['unsupportedScript()'] },
        ]),
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('ignores an unsupported command below the highest unconditional page', () => {
      const doc = convertPages([
        showTextPage(0, ['Earlier'], undefined, CLEAR_CONDITIONS, [
          { code: 355, indent: 0, parameters: ['unsupportedScript()'] },
        ]),
        showTextPage(1, ['Hi']),
      ]);

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
      expect(doc.events['rpgm-event-1']).toEqual([dialogue('Hi')]);
    });

    it('ignores conditional pages below the highest unconditional page', () => {
      const doc = convertPages([
        showTextPage(0, ['Base']),
        showTextPage(0, ['X'], undefined, {
          ...CLEAR_CONDITIONS,
          variableValid: true,
        }),
        showTextPage(0, ['Top']),
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([dialogue('Top')]);
    });

    it('uses an unconditional page above a conditional page', () => {
      const doc = convertPages([
        showTextPage(0, ['Conditional'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
        }),
        showTextPage(0, ['Always']),
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([dialogue('Always')]);
    });

    it('skips an event when expanded commands exceed 500', () => {
      const assignments = Array.from({ length: 6 }, () => ({
        code: 121,
        indent: 0,
        parameters: [1, 100, 0],
      }));
      const doc = convertPages([{ conditions: CLEAR_CONDITIONS, trigger: 0, list: assignments }]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('imports an event with exactly 500 expanded commands', () => {
      const assignments = Array.from({ length: 5 }, (_, index) => ({
        code: 121,
        indent: 0,
        parameters: [index * 100 + 1, (index + 1) * 100, 0],
      }));
      const doc = convertPages([{ conditions: CLEAR_CONDITIONS, trigger: 0, list: assignments }]);

      expect(doc.triggers).toHaveLength(1);
      expect(doc.events['rpgm-event-1']).toHaveLength(500);
    });

    it('counts commands in both branches of nested switch conditions', () => {
      const assignments = [
        [1, 100],
        [101, 200],
        [201, 250],
      ].map(([start, end]) => ({ code: 121, indent: 0, parameters: [start, end, 0] }));
      const doc = convertPages([
        { conditions: CLEAR_CONDITIONS, trigger: 0, list: assignments },
        showTextPage(0, ['Welcome'], undefined, {
          ...CLEAR_CONDITIONS,
          switch1Valid: true,
          switch1Id: 1,
          switch2Valid: true,
          switch2Id: 2,
        }),
      ]);

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('keeps a small top page when it overrides an oversized lower page', () => {
      const assignments = Array.from({ length: 6 }, () => ({
        code: 121,
        indent: 0,
        parameters: [1, 100, 0],
      }));
      const doc = convertPages([
        { conditions: CLEAR_CONDITIONS, trigger: 0, list: assignments },
        showTextPage(0, ['Always']),
      ]);

      expect(doc.events['rpgm-event-1']).toEqual([dialogue('Always')]);
    });
  });

  describe('self switches', () => {
    const selfSwitch = (letter: string, value: number): RpgmEventCommand => ({
      code: 123,
      indent: 0,
      parameters: [letter, value],
    });

    it('sets A and selects the higher page using the same scoped key', () => {
      const pages = [
        showTextPage(0, ['First visit'], undefined, CLEAR_CONDITIONS, [selfSwitch('A', 0)]),
        showTextPage(0, ['Welcome back'], undefined, {
          ...CLEAR_CONDITIONS,
          selfSwitchValid: true,
          selfSwitchCh: 'A',
        }),
      ];
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [placedEvent(pages[0], pages)],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toHaveLength(1);
      expect(doc.events['rpgm-event-1']).toEqual([
        {
          type: 'conditional',
          if: { key: 'rpgm.self.100.1.A', op: 'eq', value: true },
          then: [{ type: 'showDialogue', source: { kind: 'text', lines: ['Welcome back'] } }],
          else: [
            { type: 'showDialogue', source: { kind: 'text', lines: ['First visit'] } },
            { type: 'setWorldVar', key: 'rpgm.self.100.1.A', value: true },
          ],
        },
      ]);
      const roundTrip = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
      expect(roundTrip.triggers).toEqual(doc.triggers);
      expect(roundTrip.events).toEqual(doc.events);
    });

    it('sets B to false for value 1', () => {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [
            placedEvent(
              showTextPage(0, ['Reset'], undefined, CLEAR_CONDITIONS, [selfSwitch('B', 1)]),
            ),
          ],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'showDialogue', source: { kind: 'text', lines: ['Reset'] } },
        { type: 'setWorldVar', key: 'rpgm.self.100.1.B', value: false },
      ]);
    });

    it('imports self switch C with its event-scoped key', () => {
      const page = showTextPage(0, ['Opened'], undefined, CLEAR_CONDITIONS, [selfSwitch('C', 0)]);
      const doc = convertRpgmMap(
        buildSyntheticMap({ width: 4, height: 4, events: [placedEvent(page)] }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toHaveLength(1);
      expect(doc.events['rpgm-event-1']).toEqual([
        { type: 'showDialogue', source: { kind: 'text', lines: ['Opened'] } },
        { type: 'setWorldVar', key: 'rpgm.self.100.1.C', value: true },
      ]);
    });

    it('sets self switch D to true', () => {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [
            placedEvent(
              showTextPage(0, ['Complete'], undefined, CLEAR_CONDITIONS, [selfSwitch('D', 0)]),
            ),
          ],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.events['rpgm-event-1']).toContainEqual({
        type: 'setWorldVar',
        key: 'rpgm.self.100.1.D',
        value: true,
      });
    });

    it.each([
      ['invalid letter', ['E', 0]],
      ['invalid value', ['A', 2]],
      ['missing value', ['A']],
      ['extra value', ['A', 0, 1]],
    ])('skips an event with %s in command 123', (_label, parameters) => {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [
            placedEvent(
              showTextPage(0, ['Hello'], undefined, CLEAR_CONDITIONS, [
                { code: 123, indent: 0, parameters },
              ]),
            ),
          ],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it.each([undefined, 'E'])('skips an active self switch with letter %s', (letter) => {
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [
            placedEvent(
              showTextPage(0, ['Hello'], undefined, {
                ...CLEAR_CONDITIONS,
                selfSwitchValid: true,
                selfSwitchCh: letter,
              }),
            ),
          ],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('uses separate keys for two events on one map', () => {
      const page = showTextPage(0, ['Hello'], undefined, CLEAR_CONDITIONS, [selfSwitch('A', 0)]);
      const doc = convertRpgmMap(
        buildSyntheticMap({
          width: 4,
          height: 4,
          events: [placedEvent(page), { ...placedEvent(page), id: 2 }],
        }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toHaveLength(2);
      expect(doc.events['rpgm-event-1']?.[1]).toEqual({
        type: 'setWorldVar',
        key: 'rpgm.self.100.1.A',
        value: true,
      });
      expect(doc.events['rpgm-event-2']?.[1]).toEqual({
        type: 'setWorldVar',
        key: 'rpgm.self.100.2.A',
        value: true,
      });
    });

    it.each([null, undefined])('skips command 123 when the map id is %s', (id) => {
      const page = showTextPage(0, ['Hello'], undefined, CLEAR_CONDITIONS, [selfSwitch('A', 0)]);
      const doc = convertRpgmMap(
        buildSyntheticMap({ id, width: 4, height: 4, events: [placedEvent(page)] }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });

    it('skips a self-switch page when the map id is unavailable', () => {
      const page = showTextPage(0, ['Hello'], undefined, {
        ...CLEAR_CONDITIONS,
        selfSwitchValid: true,
        selfSwitchCh: 'A',
      });
      const doc = convertRpgmMap(
        buildSyntheticMap({ id: null, width: 4, height: 4, events: [placedEvent(page)] }),
        buildSyntheticTileset(),
      );

      expect(doc.triggers).toEqual([]);
      expect(doc.events).toEqual({});
    });
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
