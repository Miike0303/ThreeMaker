/**
 * RPG Maker MV/MZ Show Text, Show Scrolling Text, Control Switches, Control
 * Variables, and Transfer Player events → map triggers.
 *
 * For each non-null event, only the last page is considered. It is imported
 * when that page is unconditional, its trigger is action-button (0 →
 * `interact`) or player-touch (1 → `enter`), and its list contains only Show
 * Text (101 header, 401 lines), Show Scrolling Text (105 header, 405 lines),
 * Control Switches (121), Control Variables (122) that Set an integer
 * constant, an optional terminal direct-coordinate Transfer Player (201),
 * comments (108/408), and end-of-list terminators (0). Comments emit nothing.
 * A 105 with no 405 lines emits nothing. Switch and variable ids must be
 * integers ≥ 1, with start ≤ end and at most 100 ids. Any other variable
 * operation or operand, unsupported command, conditional last page, or list
 * that yields no commands skips the event. Malformed entries are skipped.
 */

import type { MapEventScripts, TriggerDocument } from '@threemaker/map-format';
import type { RpgmEvent } from './types.js';

const PAGE_CONDITION_FLAGS = [
  'actorValid',
  'itemValid',
  'selfSwitchValid',
  'switch1Valid',
  'switch2Valid',
  'variableValid',
] as const;

/** Inclusive id span of one Control Switches / Control Variables command. */
const MAX_ASSIGNMENT_IDS = 100;

type ShowTextCommand = {
  readonly type: 'showDialogue';
  readonly speaker?: string;
  readonly source: { readonly kind: 'text'; readonly lines: readonly string[] };
};

type TransferMapCommand = {
  readonly type: 'transferMap';
  readonly mapFile: string;
  readonly x: number;
  readonly y: number;
  readonly facing?: 'down' | 'left' | 'right' | 'up';
};

type SetWorldVarCommand = {
  readonly type: 'setWorldVar';
  readonly key: string;
  readonly value: boolean | number;
};

type ImportedCommand = ShowTextCommand | TransferMapCommand | SetWorldVarCommand;

type PendingDialogue = {
  /** 105/405 scrolling text has no speaker; 101/401 Show Text may. */
  readonly scrolling: boolean;
  readonly speaker?: string;
  readonly lines: string[];
};

export function showTextEventPorts(
  events: readonly (RpgmEvent | null)[],
  floorId: string,
  width: number,
  height: number,
  transferMapFile: (mapId: number) => string,
): { triggers: TriggerDocument[]; events: MapEventScripts } {
  const triggers: TriggerDocument[] = [];
  const scripts: Record<string, readonly ImportedCommand[]> = {};

  for (const entry of events) {
    const imported = importShowTextEvent(entry, floorId, width, height, transferMapFile);
    if (imported === null) continue;
    triggers.push(imported.trigger);
    scripts[imported.trigger.event] = imported.commands;
  }

  return { triggers, events: scripts };
}

function importShowTextEvent(
  entry: RpgmEvent | null,
  floorId: string,
  width: number,
  height: number,
  transferMapFile: (mapId: number) => string,
): { readonly trigger: TriggerDocument; readonly commands: readonly ImportedCommand[] } | null {
  if (!isRecord(entry)) return null;
  const eventId = entry.id;
  const x = entry.x;
  const y = entry.y;
  if (typeof eventId !== 'number' || !Number.isInteger(eventId)) return null;
  if (!isTileCoord(x, width) || !isTileCoord(y, height)) return null;
  if (!Array.isArray(entry.pages) || entry.pages.length === 0) return null;
  const page = entry.pages[entry.pages.length - 1];
  if (!isRecord(page) || !isUnconditional(page.conditions)) return null;
  const on = triggerKind(page.trigger);
  if (on === null) return null;
  const commands = showTextCommands(page.list, transferMapFile);
  if (commands === null || commands.length === 0) return null;
  const id = `rpgm-event-${eventId}`;
  return {
    trigger: { id, x, y, floor: floorId, on, event: id },
    commands,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTileCoord(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < limit;
}

/** Unconditional when every present page-condition flag is `false`. */
function isUnconditional(conditions: unknown): boolean {
  if (!isRecord(conditions)) return false;
  return PAGE_CONDITION_FLAGS.every((flag) => !(flag in conditions) || conditions[flag] === false);
}

function triggerKind(trigger: unknown): TriggerDocument['on'] | null {
  if (trigger === 0) return 'interact';
  if (trigger === 1) return 'enter';
  return null;
}

function showTextCommands(
  list: unknown,
  transferMapFile: (mapId: number) => string,
): readonly ImportedCommand[] | null {
  if (!Array.isArray(list)) return null;
  const commands: ImportedCommand[] = [];
  let pending: PendingDialogue | null = null;
  let transferred = false;

  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.code !== 'number') return null;
    if (entry.code === 0) continue;
    if (entry.code === 108 || entry.code === 408) continue;
    if (transferred) return null;
    if (entry.code === 201) {
      const transfer = transferPlayer(entry.parameters, transferMapFile);
      if (transfer === null) return null;
      pushPending(commands, pending);
      pending = null;
      commands.push(transfer);
      transferred = true;
      continue;
    }
    if (entry.code === 101 || entry.code === 105) {
      pushPending(commands, pending);
      pending = entry.code === 105 ? startScrollingText() : startDialogue(entry.parameters);
      continue;
    }
    if (entry.code === 401 || entry.code === 405) {
      const scrollingLine = entry.code === 405;
      if (pending === null || pending.scrolling !== scrollingLine) {
        if (pending !== null) return null;
        continue;
      }
      const line = textLine(entry.parameters);
      if (line === null) return null;
      pending.lines.push(line);
      continue;
    }
    if (entry.code === 121 || entry.code === 122) {
      const assigned =
        entry.code === 121 ? controlSwitches(entry.parameters) : controlVariables(entry.parameters);
      if (assigned === null) return null;
      pushPending(commands, pending);
      pending = null;
      for (const command of assigned) commands.push(command);
      continue;
    }
    return null;
  }

  pushPending(commands, pending);
  return commands;
}

function startDialogue(parameters: unknown): PendingDialogue {
  const lines: string[] = [];
  const speaker = speakerName(parameters);
  return speaker === undefined ? { scrolling: false, lines } : { scrolling: false, speaker, lines };
}

function startScrollingText(): PendingDialogue {
  return { scrolling: true, lines: [] };
}

function pushPending(commands: ImportedCommand[], pending: PendingDialogue | null): void {
  if (pending === null || pending.lines.length === 0) return;
  commands.push(showDialogue(pending.lines, pending.speaker));
}

function transferPlayer(
  parameters: unknown,
  transferMapFile: (mapId: number) => string,
): TransferMapCommand | null {
  if (!Array.isArray(parameters)) return null;
  // Ignore fadeType: the runtime owns transitions; RPG Maker defaults to black fade.
  const [designation, mapId, x, y, direction]: readonly unknown[] = parameters;
  if (designation !== 0) return null;
  if (typeof mapId !== 'number' || !Number.isInteger(mapId) || mapId < 1) return null;
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0) return null;
  if (typeof y !== 'number' || !Number.isInteger(y) || y < 0) return null;
  const directions = { 2: 'down', 4: 'left', 6: 'right', 8: 'up' } as const;
  if (direction === 0) return { type: 'transferMap', mapFile: transferMapFile(mapId), x, y };
  if (direction !== 2 && direction !== 4 && direction !== 6 && direction !== 8) return null;
  return {
    type: 'transferMap',
    mapFile: transferMapFile(mapId),
    x,
    y,
    facing: directions[direction],
  };
}

function showDialogue(lines: readonly string[], speaker: string | undefined): ShowTextCommand {
  const source = { kind: 'text' as const, lines };
  if (speaker === undefined) return { type: 'showDialogue', source };
  return { type: 'showDialogue', speaker, source };
}

/** MZ stores the speaker at parameters[4]. MV omits it; an empty string is no speaker. */
function speakerName(parameters: unknown): string | undefined {
  if (!Array.isArray(parameters)) return undefined;
  const name = parameters[4];
  if (typeof name === 'string' && name.length > 0) return name;
  return undefined;
}

function textLine(parameters: unknown): string | null {
  if (!Array.isArray(parameters)) return null;
  const line = parameters[0];
  return typeof line === 'string' ? line : null;
}

/**
 * Control Switches (121): params `[startId, endId, value]`, value 0 = ON and
 * 1 = OFF. Each id becomes a boolean `rpgm.switch.<id>` (type-locked).
 */
function controlSwitches(parameters: unknown): readonly SetWorldVarCommand[] | null {
  if (!Array.isArray(parameters)) return null;
  const ids = assignmentIds(parameters[0], parameters[1]);
  const flag = parameters[2];
  if (ids === null || (flag !== 0 && flag !== 1)) return null;
  const value = flag === 0;
  const commands: SetWorldVarCommand[] = [];
  for (const id of ids) {
    commands.push({ type: 'setWorldVar', key: `rpgm.switch.${id}`, value });
  }
  return commands;
}

/**
 * Control Variables (122): only operationType 0 (Set) with operandType 0
 * (constant) and an integer at parameters[4]. Other operations cannot be
 * evaluated here, so the page is rejected. Each id becomes a numeric
 * `rpgm.variable.<id>` (type-locked).
 */
function controlVariables(parameters: unknown): readonly SetWorldVarCommand[] | null {
  if (!Array.isArray(parameters)) return null;
  const ids = assignmentIds(parameters[0], parameters[1]);
  const constant = parameters[4];
  if (ids === null || parameters[2] !== 0 || parameters[3] !== 0) return null;
  if (typeof constant !== 'number' || !Number.isSafeInteger(constant)) return null;
  const commands: SetWorldVarCommand[] = [];
  for (const id of ids) {
    commands.push({ type: 'setWorldVar', key: `rpgm.variable.${id}`, value: constant });
  }
  return commands;
}

/** Integer ids ≥ 1, start ≤ end, at most {@link MAX_ASSIGNMENT_IDS} ids. */
function assignmentIds(startId: unknown, endId: unknown): number[] | null {
  if (!isAssignmentId(startId) || !isAssignmentId(endId)) return null;
  if (startId > endId || endId - startId + 1 > MAX_ASSIGNMENT_IDS) return null;
  const ids: number[] = [];
  for (let id = startId; id <= endId; id++) ids.push(id);
  return ids;
}

function isAssignmentId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
