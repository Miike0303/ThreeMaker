/**
 * RPG Maker MV/MZ Show Text, Show Scrolling Text, Control Switches, Control
 * Variables, inventory changes, and Transfer Player events → map triggers.
 *
 * For each non-null event, pages below the highest unconditional page are
 * unreachable. Every reachable page must have only supported
 * conditions, the same action-button (0 → `interact`) or player-touch (1 →
 * `enter`) trigger, and a convertible command list. The highest-index page
 * whose conditions hold supplies the commands. Lists may contain Show
 * Text (101 header, 401 lines), Show Scrolling Text (105 header, 405 lines),
 * Control Switches (121), Control Variables (122) that Set an integer
 * constant, Control Self Switch (123), Change Items/Weapons/Armors (126–128) with a positive
 * constant operand, an optional terminal direct-coordinate Transfer Player (201),
 * comments (108/408), and end-of-list terminators (0). Comments emit nothing.
 * A 105 with no 405 lines emits nothing. Switch and variable ids must be
 * integers ≥ 1, with start ≤ end and at most 100 ids. Any other variable
 * operation or operand, unsupported command, or unsupported page condition
 * skips the whole event. Empty final scripts and scripts over 500 commands
 * (including nested commands) are skipped. Malformed entries are skipped.
 */

import type { MapEventScripts, TriggerDocument } from '@threemaker/map-format';
import type { RpgmEvent } from './types.js';

const UNSUPPORTED_PAGE_CONDITION_FLAGS = ['actorValid', 'variableValid'] as const;

const MAX_EVENT_COMMANDS = 500;

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

type GiveItemCommand = {
  readonly type: 'giveItem';
  readonly itemId: string;
  readonly amount: number;
};

type ConditionalCommand = {
  readonly type: 'conditional';
  readonly if: {
    readonly key: string;
    readonly op: 'eq' | 'gt';
    readonly value: true | 0;
    readonly source?: 'world' | 'item' | 'stat';
  };
  readonly then: readonly ImportedCommand[];
  readonly else?: readonly ImportedCommand[];
};

type ImportedCommand =
  | ShowTextCommand
  | TransferMapCommand
  | SetWorldVarCommand
  | GiveItemCommand
  | ConditionalCommand;

type PendingDialogue = {
  /** 105/405 scrolling text has no speaker; 101/401 Show Text may. */
  readonly scrolling: boolean;
  readonly speaker?: string;
  readonly lines: string[];
};

export function showTextEventPorts(
  events: readonly (RpgmEvent | null)[],
  mapId: number | null,
  floorId: string,
  width: number,
  height: number,
  transferMapFile: (mapId: number) => string,
): { triggers: TriggerDocument[]; events: MapEventScripts } {
  const triggers: TriggerDocument[] = [];
  const scripts: Record<string, readonly ImportedCommand[]> = {};

  for (const entry of events) {
    const imported = importShowTextEvent(entry, mapId, floorId, width, height, transferMapFile);
    if (imported === null) continue;
    triggers.push(imported.trigger);
    scripts[imported.trigger.event] = imported.commands;
  }

  return { triggers, events: scripts };
}

function importShowTextEvent(
  entry: RpgmEvent | null,
  mapId: number | null,
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
  let firstReachablePage = 0;
  for (let index = entry.pages.length - 1; index >= 0; index--) {
    const page = entry.pages[index];
    if (isRecord(page) && isUnconditional(page.conditions)) {
      firstReachablePage = index;
      break;
    }
  }
  let on: TriggerDocument['on'] | null = null;
  let commands: readonly ImportedCommand[] = [];
  let commandCount = 0;
  for (const page of entry.pages.slice(firstReachablePage)) {
    if (!isRecord(page)) return null;
    const conditions = pageConditions(page.conditions, mapId, eventId);
    const pageOn = triggerKind(page.trigger);
    const pageCommands = showTextCommands(page.list, mapId, eventId, transferMapFile);
    if (conditions === null || pageOn === null || (on !== null && pageOn !== on)) return null;
    if (pageCommands === null) return null;
    on = pageOn;
    if (conditions.length === 0) {
      commands = pageCommands;
      commandCount = pageCommands.length;
    } else {
      const fallback = commands;
      const fallbackCount = commandCount;
      for (let index = conditions.length - 1; index >= 0; index--) {
        const condition = conditions[index];
        if (condition === undefined) return null;
        const then = index === conditions.length - 1 ? pageCommands : commands;
        const thenCount = index === conditions.length - 1 ? pageCommands.length : commandCount;
        commands = [
          {
            type: 'conditional',
            if: condition,
            then,
            ...(fallback.length > 0 ? { else: fallback } : {}),
          },
        ];
        commandCount = 1 + thenCount + (fallback.length > 0 ? fallbackCount : 0);
      }
    }
  }
  if (on === null || commands.length === 0 || commandCount > MAX_EVENT_COMMANDS) return null;
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

/** Every present RPG Maker page-condition flag must be false. */
function isUnconditional(conditions: unknown): boolean {
  if (!isRecord(conditions)) return false;
  return (
    UNSUPPORTED_PAGE_CONDITION_FLAGS.every(
      (flag) => conditions[flag] === undefined || conditions[flag] === false,
    ) &&
    (conditions.switch1Valid === undefined || conditions.switch1Valid === false) &&
    (conditions.switch2Valid === undefined || conditions.switch2Valid === false) &&
    (conditions.selfSwitchValid === undefined || conditions.selfSwitchValid === false) &&
    (conditions.itemValid === undefined || conditions.itemValid === false)
  );
}

/** Active conditions in RPG Maker's switch 1, switch 2, self switch, item order. */
function pageConditions(
  conditions: unknown,
  mapId: number | null,
  eventId: number,
): ConditionalCommand['if'][] | null {
  if (!isRecord(conditions)) return null;
  if (
    UNSUPPORTED_PAGE_CONDITION_FLAGS.some(
      (flag) => conditions[flag] !== undefined && conditions[flag] !== false,
    )
  ) {
    return null;
  }
  const conditionsForPage: ConditionalCommand['if'][] = [];
  for (const [flag, idKey] of [
    ['switch1Valid', 'switch1Id'],
    ['switch2Valid', 'switch2Id'],
  ] as const) {
    if (conditions[flag] === true) {
      if (!isAssignmentId(conditions[idKey])) return null;
      conditionsForPage.push({ key: `rpgm.switch.${conditions[idKey]}`, op: 'eq', value: true });
    } else if (conditions[flag] !== undefined && conditions[flag] !== false) {
      return null;
    }
  }
  if (conditions.selfSwitchValid === true) {
    const key = selfSwitchKey(mapId, eventId, conditions.selfSwitchCh);
    if (key === null) return null;
    conditionsForPage.push({ key, op: 'eq', value: true });
  } else if (conditions.selfSwitchValid !== undefined && conditions.selfSwitchValid !== false) {
    return null;
  }
  if (conditions.itemValid === true) {
    if (!isAssignmentId(conditions.itemId)) return null;
    conditionsForPage.push({
      key: `rpgm.item.${conditions.itemId}`,
      op: 'gt',
      value: 0,
      source: 'item',
    });
  } else if (conditions.itemValid !== undefined && conditions.itemValid !== false) {
    return null;
  }
  return conditionsForPage;
}

function selfSwitchKey(mapId: number | null, eventId: number, letter: unknown): string | null {
  if (!isAssignmentId(mapId)) return null;
  if (letter !== 'A' && letter !== 'B' && letter !== 'C' && letter !== 'D') return null;
  return `rpgm.self.${mapId}.${eventId}.${letter}`;
}

function triggerKind(trigger: unknown): TriggerDocument['on'] | null {
  if (trigger === 0) return 'interact';
  if (trigger === 1) return 'enter';
  return null;
}

function showTextCommands(
  list: unknown,
  mapId: number | null,
  eventId: number,
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
    if (
      entry.code === 121 ||
      entry.code === 122 ||
      entry.code === 123 ||
      entry.code === 126 ||
      entry.code === 127 ||
      entry.code === 128
    ) {
      const assigned =
        entry.code === 121
          ? controlSwitches(entry.parameters)
          : entry.code === 122
            ? controlVariables(entry.parameters)
            : entry.code === 123
              ? controlSelfSwitch(entry.parameters, mapId, eventId)
              : changeInventory(entry.code, entry.parameters);
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

/** Control Self Switch (123): letter A-D, 0 = ON and 1 = OFF. */
function controlSelfSwitch(
  parameters: unknown,
  mapId: number | null,
  eventId: number,
): readonly SetWorldVarCommand[] | null {
  if (!Array.isArray(parameters) || parameters.length !== 2) return null;
  const key = selfSwitchKey(mapId, eventId, parameters[0]);
  if (key === null || (parameters[1] !== 0 && parameters[1] !== 1)) return null;
  return [{ type: 'setWorldVar', key, value: parameters[1] === 0 }];
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

/** Change Items/Weapons/Armors (126–128): constant changes become signed amounts. */
function changeInventory(
  code: 126 | 127 | 128,
  parameters: unknown,
): readonly GiveItemCommand[] | null {
  if (!Array.isArray(parameters)) return null;
  if (parameters.length !== 4 && (code === 126 || parameters.length !== 5)) return null;
  if (code !== 126 && parameters.length === 5 && typeof parameters[4] !== 'boolean') return null;
  const [itemId, operation, operandType, operand]: readonly unknown[] = parameters;
  if (!isAssignmentId(itemId) || (operation !== 0 && operation !== 1) || operandType !== 0) {
    return null;
  }
  if (typeof operand !== 'number' || !Number.isSafeInteger(operand) || operand < 1) return null;
  return [
    {
      type: 'giveItem',
      itemId: `rpgm.${code === 126 ? 'item' : code === 127 ? 'weapon' : 'armor'}.${itemId}`,
      amount: operation === 0 ? operand : -operand,
    },
  ];
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
