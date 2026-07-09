import type { RpgmMap, RpgmMapLayers, TileLayer } from './types.js';

const LOGICAL_LAYER_COUNT = 6;

function sliceLayer(data: readonly number[], z: number, width: number, height: number): TileLayer {
  const size = width * height;
  const start = z * size;
  return data.slice(start, start + size);
}

/**
 * Parses a `MapXXX.json` file. `id` is the numeric map id (from the file
 * name, e.g. `21` for `Map021.json`) — the file itself carries no id, so
 * callers that know it (like `loadProject`) should pass it through.
 *
 * The raw `data` array is a flat encoding of 6 logical layers
 * (`width * height * 6` entries): 4 editable tile layers, a shadow-pencil
 * bitmask, and region ids, in that z order. See `RpgmMapLayers`.
 */
export function parseMap(json: unknown, id: number | null = null): RpgmMap {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`Invalid Map JSON: expected an object, got ${typeof json}.`);
  }

  const { width, height, tilesetId, scrollType, displayName, data } = json as Record<
    string,
    unknown
  >;

  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('Invalid Map JSON: "width" and "height" must be numbers.');
  }
  if (typeof tilesetId !== 'number') {
    throw new Error('Invalid Map JSON: "tilesetId" must be a number.');
  }
  if (!Array.isArray(data) || !data.every((value) => typeof value === 'number')) {
    throw new Error('Invalid Map JSON: "data" must be an array of numbers.');
  }

  const expectedLength = width * height * LOGICAL_LAYER_COUNT;
  if (data.length !== expectedLength) {
    throw new Error(
      `Invalid Map JSON: "data" length ${data.length} does not match width*height*6 (${expectedLength}).`,
    );
  }

  const numericData = data as number[];
  const layers: RpgmMapLayers = {
    tileLayers: [
      sliceLayer(numericData, 0, width, height),
      sliceLayer(numericData, 1, width, height),
      sliceLayer(numericData, 2, width, height),
      sliceLayer(numericData, 3, width, height),
    ],
    shadows: sliceLayer(numericData, 4, width, height),
    regions: sliceLayer(numericData, 5, width, height),
  };

  return {
    id,
    displayName: typeof displayName === 'string' ? displayName : '',
    width,
    height,
    tilesetId,
    scrollType: typeof scrollType === 'number' ? scrollType : 0,
    layers,
  };
}
