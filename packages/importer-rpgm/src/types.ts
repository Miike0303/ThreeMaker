import type { TileSheetId } from './tile-id.js';

/** One entry of `MapInfos.json` (the map tree shown in the editor sidebar). */
export interface RpgmMapInfo {
  readonly id: number;
  readonly name: string;
  readonly parentId: number;
  readonly order: number;
}

/** Image file name (without extension) for each of the 9 tileset sheets. Empty string if unused. */
export type TileSheetNames = Readonly<Record<TileSheetId, string>>;

/** One entry of `Tilesets.json`. */
export interface RpgmTileset {
  readonly id: number;
  readonly name: string;
  readonly sheetNames: TileSheetNames;
  /** Raw per-tile-id flags bitfield (length 8192), indexed by tile id. Decode with `decodeTileFlags`. */
  readonly flags: readonly number[];
}

/** Tile ids for one logical layer, row-major, length `width * height`. `0` means "no tile". */
export type TileLayer = readonly number[];

/**
 * The `data` array of a `MapXXX.json` file decoded from its raw
 * `width * height * 6` flat encoding into its 6 logical layers (z=0..5):
 * 4 editable tile layers, then a shadow-pencil bitmask, then region ids.
 */
export interface RpgmMapLayers {
  /** Layers 1-4 as edited in RPG Maker (index 0 = bottom, index 3 = top). */
  readonly tileLayers: readonly [TileLayer, TileLayer, TileLayer, TileLayer];
  /** Shadow pencil bitmask per tile (0-15). */
  readonly shadows: TileLayer;
  /** Region id per tile (0-255). */
  readonly regions: TileLayer;
}

/** A parsed `MapXXX.json` file. */
export interface RpgmMap {
  /** Numeric map id, e.g. `21` for `Map021.json`. `null` if parsed without a known id. */
  readonly id: number | null;
  readonly displayName: string;
  readonly width: number;
  readonly height: number;
  readonly tilesetId: number;
  readonly scrollType: number;
  readonly layers: RpgmMapLayers;
}

/** The parsed subset of an RPG Maker MV/MZ project this importer understands. */
export interface RpgmProject {
  readonly mapInfos: readonly RpgmMapInfo[];
  readonly tilesets: readonly RpgmTileset[];
  /** Maps found and parsed under the project's data folder, keyed by numeric map id. */
  readonly maps: ReadonlyMap<number, RpgmMap>;
}
