/**
 * Floor display labels. `painter.floorOption` already includes the noun
 * ("Floor 1" / "Planta 1"); consumers must treat the result as a complete
 * label and not prepend the same word.
 */
import { formatTemplate } from './format-template.js';

export interface FloorLabelRef {
  readonly id: string;
  readonly label?: string;
}

export function resolveFloorLabel(
  floors: readonly FloorLabelRef[],
  id: string,
  t: (key: string) => string,
): string {
  const index = floors.findIndex((floor) => floor.id === id);
  if (index === -1) return id;
  const floor = floors[index];
  return floor?.label ?? formatTemplate(t('painter.floorOption'), { index: index + 1 });
}

export function formatSpawnSummary(
  t: (key: string) => string,
  floors: readonly FloorLabelRef[],
  spawn: { readonly floor: string; readonly x: number; readonly y: number },
): string {
  return formatTemplate(t('painter.spawn.summary'), {
    floor: resolveFloorLabel(floors, spawn.floor, t),
    x: spawn.x,
    y: spawn.y,
  });
}
