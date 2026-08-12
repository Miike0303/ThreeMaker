import { describe, expect, it } from 'vitest';
import {
  CURRENT_MAP_FORMAT_VERSION,
  createBlankMapDocument,
  parseMapDocument,
  serializeMapDocument,
  validateCurrentVersionShape,
} from '../src/index.js';

const BLANK_OPTIONS = {
  id: 'blank-test',
  name: 'Blank Test',
  width: 8,
  height: 6,
  slots: {},
  flags: new Array(8192).fill(0),
} as const;

describe('createBlankMapDocument', () => {
  it('returns a valid current-version document with empty narrative ports', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    expect(doc.version).toBe(CURRENT_MAP_FORMAT_VERSION);
    expect(doc.npcs).toEqual([]);
    expect(doc.triggers).toEqual([]);
    expect(doc.events).toEqual({});
    expect(doc.worldSeeds).toEqual({});
    expect(validateCurrentVersionShape(doc)).toEqual(doc);
  });

  it('round-trips through parseMapDocument', () => {
    const doc = createBlankMapDocument(BLANK_OPTIONS);
    const parsed = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
    expect(parsed.id).toBe('blank-test');
    expect(parsed.floors).toHaveLength(1);
    expect(parsed.floors[0]?.id).toBe('floor-0');
  });
});
