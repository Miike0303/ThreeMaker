/**
 * Pure projection core: `.tmmap.json` (`@threemaker/map-format`'s
 * `MapDocument`) -> RPG Maker MZ's `Tilesets.json` / `MapInfos.json` /
 * `MapXXX.json` JSON shapes. No file IO here (see `node.ts` for that) -- this
 * module is the same "one TS implementation, testable headless" the design
 * calls for, reused unchanged by both the editor (browser) and the CLI
 * (Node).
 *
 * Multi-tileset lossiness: the design's per-slot composition model means
 * every exported map already has exactly ONE RPGM tileset entry (composed of
 * up to 9 independently-sourced sheet slots) -- this is what keeps tile IDs
 * and flags lossless across the export. What MZ genuinely cannot express is
 * per-tile SEMANTIC class metadata (`tileset.semantics`, a ThreeMaker-only
 * concept) -- `buildExportReport` surfaces that drop explicitly rather than
 * silently discarding it.
 */

import type { MapDocument, TileSheetSlot } from '@threemaker/map-format';
import { primaryFloorLayers, TILE_SHEET_SLOTS } from '@threemaker/map-format';

const SHEET_FILE_NAME_HASH_LENGTH = 12;

/**
 * Deterministic, collision-safe sheet BASE name (no extension) for one
 * composed slot: distinct source tilesets (even across different games)
 * never collide because the name is a pure function of content hash.
 * Matches RPGM's own `tilesetNames` convention (`Tilesets.json` stores base
 * names without `.png` -- corescript appends the extension when loading);
 * `node.ts`'s copy step appends `.png` for the actual on-disk file.
 */
export function sheetFileNameForSlot(slot: TileSheetSlot, sha256: string): string {
  return `${slot}_${sha256.slice(0, SHEET_FILE_NAME_HASH_LENGTH)}`;
}

export interface RpgmTilesetEntryJson {
  readonly id: number;
  readonly mode: number;
  readonly name: string;
  readonly note: string;
  readonly tilesetNames: readonly string[];
  readonly flags: readonly number[];
}

/** `Tilesets.json`'s full raw shape: `[null, entry]` (RPGM's 1-indexed sparse array convention -- index 0 is always `null`). */
export type TilesetsJson = readonly [null, RpgmTilesetEntryJson];

/**
 * Builds `Tilesets.json`. `sheetFileNames` maps a composed slot to the
 * on-disk PNG file name that will be copied into `img/tilesets/` (see
 * `node.ts`'s copy step) -- slots with no entry (not composed, or their
 * sheet file name wasn't resolved) become an empty string, matching RPGM's
 * own "unused slot" convention.
 */
export function buildTilesetsJson(
  doc: MapDocument,
  sheetFileNames: Partial<Record<TileSheetSlot, string>>,
  tilesetId: number,
): TilesetsJson {
  const tilesetNames = TILE_SHEET_SLOTS.map((slot) => sheetFileNames[slot] ?? '');
  return [
    null,
    {
      id: tilesetId,
      mode: 0,
      name: doc.name,
      note: '',
      tilesetNames,
      flags: doc.tileset.flags,
    },
  ];
}

export interface RpgmMapInfoEntryJson {
  readonly id: number;
  readonly expanded: boolean;
  readonly name: string;
  readonly order: number;
  readonly parentId: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

export type MapInfosJson = readonly [null, RpgmMapInfoEntryJson];

/** Builds `MapInfos.json` for a single root-level map -- the editor's single-working-map model (see `map-client.ts`) means v1 export never has more than one map to list. */
export function buildMapInfosJson(mapId: number, mapName: string): MapInfosJson {
  return [
    null,
    { id: mapId, expanded: false, name: mapName, order: 1, parentId: 0, scrollX: 0, scrollY: 0 },
  ];
}

const AUDIO_SILENT = { name: '', pan: 0, pitch: 100, volume: 90 } as const;

/** Builds `MapXXX.json`. All non-tile fields use MZ's own blank-template defaults (see `newdata/data/Map001.json`) since ThreeMaker's `MapDocument` doesn't model events/audio/parallax yet -- those are simply not lossy because there's nothing on the ThreeMaker side to lose. */
export function buildMapJson(doc: MapDocument, tilesetId: number): Record<string, unknown> {
  // Transitional (plantas-apiladas Slice 1): exports the primary floor's
  // layers only -- multi-floor export is out of scope until a later slice.
  const layers = primaryFloorLayers(doc);
  const data: number[] = [];
  for (const layer of layers.tiles) data.push(...layer);
  data.push(...layers.shadows);
  data.push(...layers.regions);

  return {
    autoplayBgm: false,
    autoplayBgs: false,
    battleback1Name: '',
    battleback2Name: '',
    bgm: AUDIO_SILENT,
    bgs: AUDIO_SILENT,
    disableDashing: false,
    displayName: doc.name,
    encounterList: [],
    encounterStep: 30,
    height: doc.height,
    note: '',
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxName: '',
    parallaxShow: true,
    parallaxSx: 0,
    parallaxSy: 0,
    scrollType: 0,
    specifyBattleback: false,
    tilesetId,
    width: doc.width,
    data,
    events: [],
  };
}

export interface ExportReport {
  /** Number of tile ids carrying a non-`'none'` semantic class -- dropped on export since MZ has no field for arbitrary semantic classes. */
  readonly droppedSemanticCount: number;
  /** Which composed slots (of the 9) contributed a sheet to this export. */
  readonly composedSlots: readonly TileSheetSlot[];
  /** Human-readable notes, always populated when something was dropped or approximated -- never silent. */
  readonly notes: readonly string[];
}

/**
 * Documents the export's lossy-projection rules (spec's "rpgm-export"
 * requirement: report, don't silently drop). v1's per-slot composition model
 * makes the TILE data itself lossless; the only genuine loss is semantic
 * metadata that has no MZ equivalent.
 */
export function buildExportReport(doc: MapDocument): ExportReport {
  const composedSlots = TILE_SHEET_SLOTS.filter((slot) => doc.tileset.slots[slot] !== undefined);
  const droppedSemanticCount = Object.values(doc.tileset.semantics).filter(
    (entry) => entry.class !== 'none',
  ).length;

  const notes: string[] = [];
  notes.push(
    `Composed from ${composedSlots.length} sheet slot(s) (${composedSlots.join(', ') || 'none'}) into a single MZ tileset entry -- lossless per the per-slot composition model.`,
  );
  if (droppedSemanticCount > 0) {
    notes.push(
      `${droppedSemanticCount} tile id(s) had a ThreeMaker semantic class assigned; RPG Maker MZ has no field for this and it was NOT exported. The underlying RPGM flags bitfield (passability/etc.) was preserved.`,
    );
  }

  return { droppedSemanticCount, composedSlots, notes };
}
