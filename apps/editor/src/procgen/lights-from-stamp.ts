/**
 * Build placed point lights at dungeon stamp room centers (WU-PROC-14).
 * Pure — used by applyDungeonStampToMapDocument when placeRoomLights is on.
 */
import type { LightDocument } from '@threemaker/map-format';
import type { DungeonRoom } from './dungeon-stamp.js';

export const DEFAULT_STAMP_LIGHT_COLOR = '#ffaa00';
export const DEFAULT_STAMP_LIGHT_INTENSITY = 1.2;
export const DEFAULT_STAMP_LIGHT_RANGE = 5;
export const DEFAULT_STAMP_LIGHT_HEIGHT = 2;

export type StampRoomLightOptions = {
  readonly kind?: LightDocument['kind'];
  readonly color?: string;
  readonly intensity?: number;
  readonly range?: number;
  readonly height?: number;
  /** Id prefix before the 1-based index (default `stamp-light`). */
  readonly idPrefix?: string;
};

/** Integer center of a stamp room (same formula as pickMainRoomSpawn for one room). */
export function dungeonRoomCenter(room: DungeonRoom): { readonly x: number; readonly y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

/**
 * One placed point light per room at its center. Empty rooms → empty list.
 * Ids are `${prefix}-1` … stable with room order.
 */
export function lightsFromDungeonRooms(
  rooms: readonly DungeonRoom[],
  floorId: string,
  options: StampRoomLightOptions = {},
): readonly LightDocument[] {
  const kind = options.kind ?? 'point';
  const color = options.color ?? DEFAULT_STAMP_LIGHT_COLOR;
  const intensity = options.intensity ?? DEFAULT_STAMP_LIGHT_INTENSITY;
  const range = options.range ?? DEFAULT_STAMP_LIGHT_RANGE;
  const height = options.height ?? DEFAULT_STAMP_LIGHT_HEIGHT;
  const idPrefix = options.idPrefix ?? 'stamp-light';

  return rooms.map((room, index) => {
    const center = dungeonRoomCenter(room);
    return {
      id: `${idPrefix}-${index + 1}`,
      kind,
      color,
      intensity,
      range,
      x: center.x,
      y: center.y,
      floor: floorId,
      height,
    };
  });
}

/**
 * Merge stamp room lights into an existing lights collection:
 * drop previous placed lights on `floorId`, keep attached + other floors,
 * then append `stampLights`.
 */
export function mergeStampRoomLights(
  existing: readonly LightDocument[],
  floorId: string,
  stampLights: readonly LightDocument[],
): readonly LightDocument[] {
  const kept = existing.filter((light) => light.attach !== undefined || light.floor !== floorId);
  return [...kept, ...stampLights];
}

export const DEFAULT_PLAYER_TORCH_ID = 'player-torch';
export const DEFAULT_PLAYER_TORCH_COLOR = '#ff8800';
export const DEFAULT_PLAYER_TORCH_INTENSITY = 1;
export const DEFAULT_PLAYER_TORCH_RANGE = 3;

export type PlayerTorchOptions = {
  readonly id?: string;
  readonly color?: string;
  readonly intensity?: number;
  readonly range?: number;
  readonly kind?: LightDocument['kind'];
};

/** Attached point light on `player` (handheld torch). */
export function playerTorchLight(options: PlayerTorchOptions = {}): LightDocument {
  return {
    id: options.id ?? DEFAULT_PLAYER_TORCH_ID,
    kind: options.kind ?? 'point',
    color: options.color ?? DEFAULT_PLAYER_TORCH_COLOR,
    intensity: options.intensity ?? DEFAULT_PLAYER_TORCH_INTENSITY,
    range: options.range ?? DEFAULT_PLAYER_TORCH_RANGE,
    attach: 'player',
  };
}

/**
 * Ensure a player-attached torch exists. Replaces any prior `attach: player`
 * lights (or same id) so re-Generate stays single-torch; keeps other attaches.
 */
export function ensurePlayerTorch(
  existing: readonly LightDocument[],
  options: PlayerTorchOptions = {},
): readonly LightDocument[] {
  const torch = playerTorchLight(options);
  const kept = existing.filter((light) => light.attach !== 'player' && light.id !== torch.id);
  return [...kept, torch];
}
