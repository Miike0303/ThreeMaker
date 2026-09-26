/**
 * RPG Maker MV/MZ "Show Text" events → map triggers.
 *
 * For each non-null event, only the last page is considered. It is imported
 * when that page is unconditional, its trigger is action-button (0 →
 * `interact`) or player-touch (1 → `enter`), and its list contains only Show
 * Text (101 header, 401 lines) plus the end-of-list terminator (0). Any other
 * command, a conditional last page, or a list that yields no dialogue skips
 * the event. Malformed entries are skipped and never thrown.
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

type ShowTextCommand = {
  readonly type: 'showDialogue';
  readonly speaker?: string;
  readonly source: { readonly kind: 'text'; readonly lines: readonly string[] };
};

type PendingDialogue = {
  readonly speaker?: string;
  readonly lines: string[];
};

export function showTextEventPorts(
  events: readonly (RpgmEvent | null)[],
  floorId: string,
  width: number,
  height: number,
): { triggers: TriggerDocument[]; events: MapEventScripts } {
  const triggers: TriggerDocument[] = [];
  const scripts: Record<string, readonly ShowTextCommand[]> = {};

  for (const entry of events) {
    const imported = importShowTextEvent(entry, floorId, width, height);
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
): { readonly trigger: TriggerDocument; readonly commands: readonly ShowTextCommand[] } | null {
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
  const commands = showTextCommands(page.list);
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

function showTextCommands(list: unknown): readonly ShowTextCommand[] | null {
  if (!Array.isArray(list)) return null;
  const commands: ShowTextCommand[] = [];
  let pending: PendingDialogue | null = null;

  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.code !== 'number') return null;
    if (entry.code === 0) continue;
    if (entry.code === 101) {
      pushPending(commands, pending);
      pending = startDialogue(entry.parameters);
      continue;
    }
    if (entry.code === 401) {
      const line = textLine(entry.parameters);
      if (line === null) return null;
      pending?.lines.push(line);
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
  return speaker === undefined ? { lines } : { speaker, lines };
}

function pushPending(commands: ShowTextCommand[], pending: PendingDialogue | null): void {
  if (pending === null || pending.lines.length === 0) return;
  commands.push(showDialogue(pending.lines, pending.speaker));
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
