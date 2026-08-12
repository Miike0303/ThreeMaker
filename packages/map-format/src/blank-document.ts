import type { MapDocument, SlotComposition } from './schema.js';
import { CURRENT_MAP_FORMAT_VERSION, MAP_FORMAT_MAGIC } from './schema.js';

export interface CreateBlankMapDocumentOptions {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly slots: SlotComposition;
  readonly flags: readonly number[];
}

/**
 * A blank (all-zero) map at the current format version, with the given slot
 * composition already set. Fresh maps carry empty narrative ports (npcs,
 * triggers, events, worldSeeds) until an authoring path fills them in.
 */
export function createBlankMapDocument(options: CreateBlankMapDocumentOptions): MapDocument {
  const size = options.width * options.height;
  const emptyLayer = (): number[] => new Array(size).fill(0);
  return {
    format: MAP_FORMAT_MAGIC,
    version: CURRENT_MAP_FORMAT_VERSION,
    id: options.id,
    name: options.name,
    width: options.width,
    height: options.height,
    tileset: { slots: options.slots, flags: options.flags, semantics: {}, tilePixelSize: 48 },
    floors: [
      {
        id: 'floor-0',
        baseElevation: 0,
        layers: {
          tiles: [emptyLayer(), emptyLayer(), emptyLayer(), emptyLayer()],
          shadows: emptyLayer(),
          regions: emptyLayer(),
        },
      },
    ],
    stairLinks: [],
    rooms: [],
    npcs: [],
    triggers: [],
    events: {},
    worldSeeds: {},
    props: [],
    lights: [],
  };
}
