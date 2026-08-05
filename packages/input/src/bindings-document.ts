/**
 * Versioned user input-bindings document (C2 WU-04).
 *
 * Same spirit as `map-format/migrate.ts`: magic + integer version, validate
 * before use, unknown versions / malformed payloads fail closed so the host
 * can fall back to defaults without crashing boot.
 *
 * I/O stays in the host; this module is pure parse / serialize / merge.
 */

import type { BindingTable } from './binding-table.js';
import { createBindingTable } from './binding-table.js';
import { defaultKeyboardBindings } from './defaults.js';
import { clearKeyboardSourcesForAction, rebindKeyboard } from './rebind.js';
import type { ActionBinding, ActionId, DeviceSource } from './types.js';

export const INPUT_BINDINGS_MAGIC = 'threemaker.input-bindings' as const;
export const CURRENT_INPUT_BINDINGS_VERSION = 1 as const;

export type InputBindingsParseOk = {
  readonly ok: true;
  readonly version: number;
  readonly bindings: readonly ActionBinding[];
};

export type InputBindingsParseFail = {
  readonly ok: false;
  readonly reason: string;
};

export type InputBindingsParseResult = InputBindingsParseOk | InputBindingsParseFail;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseDeviceSource(raw: unknown): DeviceSource | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (record.device !== 'keyboard') return undefined;
  if (!isNonEmptyString(record.key)) return undefined;
  return { device: 'keyboard', key: record.key };
}

function parseBinding(raw: unknown): ActionBinding | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.action)) return undefined;
  const source = parseDeviceSource(record.source);
  if (source === undefined) return undefined;
  return { action: record.action, source };
}

/**
 * Validate a decoded JSON value as an input-bindings document.
 * Never throws — invalid input yields `{ ok: false }`.
 */
export function parseInputBindingsDocument(raw: unknown): InputBindingsParseResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'document must be an object' };
  }
  const record = raw as Record<string, unknown>;
  if (record.magic !== INPUT_BINDINGS_MAGIC) {
    return { ok: false, reason: 'missing or invalid magic' };
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version)) {
    return { ok: false, reason: 'version must be an integer' };
  }
  if (record.version !== CURRENT_INPUT_BINDINGS_VERSION) {
    return { ok: false, reason: `unknown version ${record.version}` };
  }
  if (!Array.isArray(record.bindings)) {
    return { ok: false, reason: 'bindings must be an array' };
  }

  const bindings: ActionBinding[] = [];
  for (const entry of record.bindings) {
    const binding = parseBinding(entry);
    if (binding === undefined) {
      return { ok: false, reason: 'invalid binding entry' };
    }
    bindings.push(binding);
  }

  return { ok: true, version: record.version, bindings };
}

/** Serialize overrides (or any binding list) as a v1 document JSON string. */
export function serializeInputBindingsDocument(bindings: readonly ActionBinding[]): string {
  return JSON.stringify({
    magic: INPUT_BINDINGS_MAGIC,
    version: CURRENT_INPUT_BINDINGS_VERSION,
    bindings,
  });
}

/**
 * Apply user overrides on top of `base`.
 *
 * Keyboard overrides for the same action replace that action's keyboard
 * sources (rebind semantics). Multiple keyboard sources for one action in
 * `overrides` are all applied after a single clear.
 */
export function applyBindingOverrides(
  base: BindingTable,
  overrides: readonly ActionBinding[],
): BindingTable {
  if (overrides.length === 0) return base;

  const byAction = new Map<ActionId, ActionBinding[]>();
  for (const binding of overrides) {
    const list = byAction.get(binding.action) ?? [];
    list.push(binding);
    byAction.set(binding.action, list);
  }

  let next = base;
  for (const [action, actionBindings] of byAction) {
    const keyboardOnly = actionBindings.every((b) => b.source.device === 'keyboard');
    if (keyboardOnly && actionBindings.length === 1) {
      const only = actionBindings[0];
      if (only && only.source.device === 'keyboard') {
        next = rebindKeyboard(next, action, only.source.key);
        continue;
      }
    }
    next = clearKeyboardSourcesForAction(next, action);
    for (const binding of actionBindings) {
      next = next.withoutSource(binding.source).withBinding(binding);
    }
  }
  return next;
}

function keyboardKeysForAction(table: BindingTable, action: ActionId): string[] {
  return table
    .list()
    .filter((b) => b.action === action && b.source.device === 'keyboard')
    .map((b) => b.source.key.toLowerCase())
    .sort();
}

/**
 * Bindings that differ from the default keyboard set — what we persist so
 * load can re-apply them over fresh defaults.
 */
export function collectBindingOverrides(
  table: BindingTable,
  defaults: readonly ActionBinding[] = defaultKeyboardBindings(),
): readonly ActionBinding[] {
  const defaultTable = createBindingTable(defaults);
  const actions = new Set<ActionId>();
  for (const b of table.list()) actions.add(b.action);
  for (const b of defaults) actions.add(b.action);

  const overrides: ActionBinding[] = [];
  for (const action of actions) {
    const current = keyboardKeysForAction(table, action).join('\0');
    const baseline = keyboardKeysForAction(defaultTable, action).join('\0');
    if (current === baseline) continue;
    for (const binding of table.list()) {
      if (binding.action === action && binding.source.device === 'keyboard') {
        overrides.push(binding);
      }
    }
  }
  return overrides;
}

/**
 * Boot helper: parse raw JSON text (or null when file missing) into a table.
 * Any failure yields the default keyboard table — never throws.
 */
export function bindingTableFromPersistedText(
  text: string | null,
  defaults: readonly ActionBinding[] = defaultKeyboardBindings(),
): BindingTable {
  const base = createBindingTable(defaults);
  if (text === null || text.trim() === '') return base;

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return base;
  }

  const parsed = parseInputBindingsDocument(raw);
  if (!parsed.ok) return base;
  return applyBindingOverrides(base, parsed.bindings);
}
