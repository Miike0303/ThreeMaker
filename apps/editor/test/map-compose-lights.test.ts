/**
 * C6 WU-05 / WU-LIGHT-03: editor compose must not drop schema-v6 lights or
 * per-floor `lightMap` through the painter floor rebuild.
 */
import type { LightDocument, MapDocument } from '@threemaker/map-format';
import { parseMapDocument, serializeMapDocument } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import {
  type CreateBlankMapDocumentOptions,
  composeDocumentFromPainterFloors,
  createBlankMapDocument,
  painterFloorsFromDocument,
} from '../src/map-compose.js';

const BLANK_OPTIONS: CreateBlankMapDocumentOptions = {
  id: 'v6-lights-editor',
  name: 'V6 Lights Editor',
  width: 4,
  height: 4,
  slots: {},
  flags: new Array(8192).fill(0),
};

const LIGHTMAP_SHA = 'c'.repeat(64);

const PLACED_LAMP: LightDocument = {
  id: 'ceiling-lamp',
  kind: 'point',
  color: '#ffaa00',
  intensity: 1.5,
  range: 4,
  x: 1,
  y: 2,
  floor: 'floor-0',
  height: 2,
};

const PLAYER_TORCH: LightDocument = {
  id: 'player-torch',
  kind: 'point',
  color: '#ff8800',
  intensity: 1,
  range: 3,
  attach: 'player',
};

describe('composeDocumentFromPainterFloors: lights + floor lightMap (C6)', () => {
  it('preserves authored lights through compose -> serialize -> parse', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const ground = blank.floors[0];
    if (!ground) throw new Error('blank always has floors[0]');

    const doc: MapDocument = {
      ...blank,
      floors: [{ ...ground, lightMap: LIGHTMAP_SHA }],
      lights: [PLACED_LAMP, PLAYER_TORCH],
    };

    const composed = composeDocumentFromPainterFloors(
      doc,
      painterFloorsFromDocument(doc),
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.lights).toEqual([PLACED_LAMP, PLAYER_TORCH]);
    expect(reparsed.version).toBe(doc.version);
  });

  it('preserves floor lightMap through painter floor rebuild (WU-LIGHT-03)', () => {
    // composeDocumentFromPainterFloors rebuilds FloorDocument from painter
    // layers and re-attaches shadows/regions/lightMap from the original.
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const ground = blank.floors[0];
    if (!ground) throw new Error('blank always has floors[0]');

    const doc: MapDocument = {
      ...blank,
      floors: [{ ...ground, lightMap: LIGHTMAP_SHA }],
      lights: [PLACED_LAMP],
    };

    expect(doc.floors[0]?.lightMap).toBe(LIGHTMAP_SHA);

    const composed = composeDocumentFromPainterFloors(
      doc,
      painterFloorsFromDocument(doc),
      doc.rooms,
      doc.stairLinks,
      doc.spawn,
      doc.props,
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));

    expect(reparsed.lights).toEqual([PLACED_LAMP]);
    expect(reparsed.floors[0]?.lightMap).toBe(LIGHTMAP_SHA);
    expect(Object.hasOwn(JSON.parse(serializeMapDocument(composed)).floors[0], 'lightMap')).toBe(
      true,
    );
  });

  it('does not invent lightMap on floors that never had one', () => {
    const blank = createBlankMapDocument(BLANK_OPTIONS);
    const composed = composeDocumentFromPainterFloors(
      blank,
      painterFloorsFromDocument(blank),
    );
    const reparsed = parseMapDocument(JSON.parse(serializeMapDocument(composed)));
    expect(reparsed.floors[0]?.lightMap).toBeUndefined();
    expect(Object.hasOwn(JSON.parse(serializeMapDocument(composed)).floors[0], 'lightMap')).toBe(
      false,
    );
  });
});
