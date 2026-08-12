export const DEFAULT_MAP_NAME = 'New Map';
export const DEFAULT_MAP_WIDTH = 20;
export const DEFAULT_MAP_HEIGHT = 15;
export const MAP_DIMENSION_MIN = 8;
export const MAP_DIMENSION_MAX = 128;

export interface NewMapDraft {
  readonly name: string;
  readonly width: string | number;
  readonly height: string | number;
}

export interface NewMapValues {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export type NewMapDraftResult =
  | { readonly valid: true; readonly value: NewMapValues }
  | {
      readonly valid: false;
      readonly errors: { readonly name: boolean; readonly width: boolean; readonly height: boolean };
    };

export function normalizeNewMapName(input: string): string | null {
  const name = input.trim();
  return name.length > 0 ? name : null;
}

export function normalizeMapDimension(input: string | number): number | null {
  if (typeof input === 'string' && input.trim() === '') return null;
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < MAP_DIMENSION_MIN || value > MAP_DIMENSION_MAX) return null;
  return value;
}

export function validateNewMapDraft(draft: NewMapDraft): NewMapDraftResult {
  const name = normalizeNewMapName(draft.name);
  const width = normalizeMapDimension(draft.width);
  const height = normalizeMapDimension(draft.height);
  if (name === null || width === null || height === null) {
    return {
      valid: false,
      errors: { name: name === null, width: width === null, height: height === null },
    };
  }
  return { valid: true, value: { name, width, height } };
}
