/**
 * Pure helpers for the events-editor forms (WU-02).
 *
 * Field parsing/coercion and the save hard-gate live here so they stay
 * unit-testable without mounting React. `PainterPanel` / `CommandForm`
 * stay thin shells over these + painter-store ops.
 */

import type { EventCommand, WorldValue } from '@threemaker/core';
import { BUILTIN_COMMAND_TYPES } from '@threemaker/core';
import { isSafeStoryId } from './ink-sidecar.js';
import { type EventCommandKind, validateEventsDraft } from './painter-store.js';

export type InkKnotInventory =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly knots: readonly string[] }
  | { readonly status: 'missing' }
  | { readonly status: 'error' };

export type InkStoryPickerStatus =
  | 'ready'
  | 'unsafe-story-id'
  | 'unknown-story'
  | 'loading'
  | 'missing-sidecar'
  | 'sidecar-error';

export interface InkDialoguePickerModel {
  readonly storyOptions: readonly string[];
  readonly knotOptions: readonly string[];
  readonly storyStatus: InkStoryPickerStatus;
  readonly knotStatus: 'ready' | 'unknown-knot';
}

/** Pure presentation model; custom/dangling values remain selectable and editable. */
export function buildInkDialoguePickerModel(
  knownStoryIds: readonly string[],
  inventories: Readonly<Record<string, InkKnotInventory | undefined>>,
  storyId: string,
  knot: string,
): InkDialoguePickerModel {
  const storyOptions = [...new Set([...knownStoryIds, ...(storyId ? [storyId] : [])])];
  const inventory = inventories[storyId];
  let storyStatus: InkStoryPickerStatus;
  if (!isSafeStoryId(storyId)) storyStatus = 'unsafe-story-id';
  else if (!knownStoryIds.includes(storyId)) storyStatus = 'unknown-story';
  else if (!inventory) storyStatus = 'unknown-story';
  else if (inventory.status === 'loaded') storyStatus = 'ready';
  else if (inventory.status === 'loading') storyStatus = 'loading';
  else if (inventory.status === 'missing') storyStatus = 'missing-sidecar';
  else storyStatus = 'sidecar-error';
  const loadedKnots = inventory?.status === 'loaded' ? inventory.knots : [];
  const knotStatus = knot === '' || loadedKnots.includes(knot) ? 'ready' : 'unknown-knot';
  return {
    storyOptions,
    knotOptions: [...new Set([...loadedKnots, ...(knot ? [knot] : [])])],
    storyStatus,
    knotStatus,
  };
}

export type TransferMapPickerStatus = 'ready' | 'unknown-map' | 'empty';

export interface TransferMapPickerModel {
  readonly mapFileOptions: readonly string[];
  readonly mapFileStatus: TransferMapPickerStatus;
}

/**
 * Pure presentation model for `transferMap.mapFile` — same datalist + soft
 * warning pattern as the Ink knot picker. Custom/dangling values stay editable.
 */
export function buildTransferMapPickerModel(
  knownMapFiles: readonly string[],
  mapFile: string,
): TransferMapPickerModel {
  const mapFileOptions = [...new Set([...knownMapFiles, ...(mapFile ? [mapFile] : [])])];
  let mapFileStatus: TransferMapPickerStatus;
  if (mapFile === '') mapFileStatus = 'empty';
  else if (knownMapFiles.includes(mapFile)) mapFileStatus = 'ready';
  else mapFileStatus = 'unknown-map';
  return { mapFileOptions, mapFileStatus };
}

/** Discriminator for WorldValue / WorldSeedValue type selectors in forms. */
export type WorldValueKind = 'boolean' | 'number' | 'string';

/** Builtin event-script command kinds for the kind picker — same list core parses. */
export const EVENT_COMMAND_KINDS: readonly EventCommandKind[] = BUILTIN_COMMAND_TYPES;

/** `typeof` for a WorldValue (boolean | number | string). */
export function worldValueKind(value: WorldValue): WorldValueKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/**
 * Coerce a form input into a WorldValue of `kind`. Non-finite numbers and
 * unparseable number text fall back to `0`; boolean text is only `true` when
 * the raw string is exactly `"true"` (or the value is already boolean true).
 */
export function parseWorldValue(kind: WorldValueKind, raw: string | boolean | number): WorldValue {
  switch (kind) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw !== 0;
      return raw === 'true';
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case 'string':
      return String(raw);
  }
}

/** Zero-ish default when the author switches a world-seed / WorldValue type. */
export function defaultWorldSeedValue(kind: WorldValueKind): WorldValue {
  switch (kind) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
  }
}

/** Integer parse for numeric form fields; `fallback` on empty/NaN. */
export function parseIntField(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Float parse for numeric form fields; `fallback` on empty/NaN. */
export function parseNumberField(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** One textarea row → one dialogue line (including empty rows). */
export function dialogueLinesFromTextarea(text: string): string[] {
  return text.split('\n');
}

/** Dialogue lines → textarea value. */
export function dialogueLinesToTextarea(lines: readonly string[]): string {
  return lines.join('\n');
}

/**
 * Save hard-gate seam for `handleSave`: returns `null` when the live events
 * draft is valid, otherwise the `validateEventsDraft` error message (block
 * save and surface it).
 */
export function canSavePainterDocument(state: {
  readonly events: Readonly<Record<string, readonly EventCommand[]>>;
}): string | null {
  return validateEventsDraft(state.events);
}
