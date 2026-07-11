import type { WorldValue } from './world-state.js';

/** Facing/movement direction shared with `@threemaker/gameplay`'s `Direction` (structurally identical; core depends on nothing). */
export type CardinalDirection = 'down' | 'left' | 'right' | 'up';

const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = ['down', 'left', 'right', 'up'];

/** Comparison operator for a {@link ConditionalCommand}'s `if` clause. */
export type ConditionalOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';

const CONDITIONAL_OPS: readonly ConditionalOp[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'];

/** Where a `showDialogue` command reads its content from. */
export type DialogueSource =
  | { readonly kind: 'ink'; readonly storyId: string; readonly knot?: string }
  | { readonly kind: 'text'; readonly lines: readonly string[] };

export type MoveEntityCommand = {
  readonly type: 'moveEntity';
  readonly entityId: string;
  readonly direction: CardinalDirection;
  readonly steps: number;
};

export type ShowDialogueCommand = {
  readonly type: 'showDialogue';
  readonly speaker?: string;
  readonly source: DialogueSource;
};

export type ConditionalCommand = {
  readonly type: 'conditional';
  readonly if: { readonly key: string; readonly op: ConditionalOp; readonly value: WorldValue };
  /**
   * Commands to run when `if` matches. Named `then` per the v1 contract
   * (not renameable — the field name is part of the schema, authored as
   * content JSON). Biome's `suspicious/noThenProperty` rule flags any
   * object with a `then` key as a possible thenable false positive; see the
   * scoped override in `biome.json` for the files that legitimately
   * construct these literals.
   */
  readonly then: readonly EventCommand[];
  /** Commands to run when `if` does not match, or omitted to run nothing. See {@link ConditionalCommand.then} for the `noThenProperty` note. */
  readonly else?: readonly EventCommand[];
};

export type SetWorldVarCommand = {
  readonly type: 'setWorldVar';
  readonly key: string;
  readonly value: WorldValue;
};

export type TeleportCommand = {
  readonly type: 'teleport';
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
  readonly facing?: CardinalDirection;
};

/** Discriminated union of every event-script command in schema v1. */
export type EventCommand =
  | MoveEntityCommand
  | ShowDialogueCommand
  | ConditionalCommand
  | SetWorldVarCommand
  | TeleportCommand;

/** Parsed shape of an event script file: `{ version: 1, events: Record<string, EventCommand[]> }`. */
export type EventScript = Record<string, EventCommand[]>;

function fail(message: string): never {
  throw new Error(`Invalid Event Script: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorldValue(value: unknown): value is WorldValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function parseCardinalDirection(value: unknown, path: string, field: string): CardinalDirection {
  if (typeof value !== 'string' || !CARDINAL_DIRECTIONS.includes(value as CardinalDirection)) {
    fail(
      `${path} "${field}" must be one of ${CARDINAL_DIRECTIONS.join(', ')}, got ${JSON.stringify(value)}.`,
    );
  }
  return value as CardinalDirection;
}

function parseDialogueSource(value: unknown, path: string): DialogueSource {
  if (!isRecord(value)) {
    fail(`${path} requires a "source" object.`);
  }
  const { kind } = value;
  if (kind === 'text') {
    const { lines } = value;
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) {
      fail(`${path} text source requires an array "lines".`);
    }
    return { kind: 'text', lines: lines as string[] };
  }
  if (kind === 'ink') {
    const { storyId, knot } = value;
    if (typeof storyId !== 'string') {
      fail(`${path} ink source requires a string "storyId".`);
    }
    if (knot !== undefined && typeof knot !== 'string') {
      fail(`${path} ink source "knot" must be a string when present.`);
    }
    return { kind: 'ink', storyId, ...(knot !== undefined ? { knot } : {}) };
  }
  fail(`${path} source has unknown "kind" ${JSON.stringify(kind)}.`);
}

function parseEventCommand(value: unknown, path: string): EventCommand {
  if (!isRecord(value)) {
    fail(`${path} must be an object.`);
  }
  const { type } = value;
  if (typeof type !== 'string') {
    fail(`${path} is missing a string "type".`);
  }

  switch (type) {
    case 'moveEntity': {
      const label = `${path} (moveEntity)`;
      const { entityId, direction, steps } = value;
      if (typeof entityId !== 'string') fail(`${label} requires a string "entityId".`);
      const parsedDirection = parseCardinalDirection(direction, label, 'direction');
      if (typeof steps !== 'number') fail(`${label} requires a number "steps".`);
      return { type: 'moveEntity', entityId, direction: parsedDirection, steps };
    }
    case 'showDialogue': {
      const label = `${path} (showDialogue)`;
      const { speaker, source } = value;
      if (speaker !== undefined && typeof speaker !== 'string') {
        fail(`${label} "speaker" must be a string when present.`);
      }
      const parsedSource = parseDialogueSource(source, label);
      return {
        type: 'showDialogue',
        ...(speaker !== undefined ? { speaker } : {}),
        source: parsedSource,
      };
    }
    case 'conditional': {
      const label = `${path} (conditional)`;
      const { if: condition, then, else: elseBranch } = value;
      if (!isRecord(condition)) fail(`${label} requires an "if" object.`);
      const { key, op, value: conditionValue } = condition;
      if (typeof key !== 'string') fail(`${label} "if.key" must be a string.`);
      if (typeof op !== 'string' || !CONDITIONAL_OPS.includes(op as ConditionalOp)) {
        fail(
          `${label} "if.op" must be one of ${CONDITIONAL_OPS.join(', ')}, got ${JSON.stringify(op)}.`,
        );
      }
      if (!isWorldValue(conditionValue)) {
        fail(`${label} "if.value" must be a boolean, number, or string.`);
      }
      if (!Array.isArray(then)) fail(`${label} requires an array "then".`);
      const parsedThen = then.map((command, index) =>
        parseEventCommand(command, `${label}.then[${index}]`),
      );
      let parsedElse: EventCommand[] | undefined;
      if (elseBranch !== undefined) {
        if (!Array.isArray(elseBranch)) fail(`${label} "else" must be an array when present.`);
        parsedElse = elseBranch.map((command, index) =>
          parseEventCommand(command, `${label}.else[${index}]`),
        );
      }
      return {
        type: 'conditional',
        if: { key, op: op as ConditionalOp, value: conditionValue },
        then: parsedThen,
        ...(parsedElse !== undefined ? { else: parsedElse } : {}),
      };
    }
    case 'setWorldVar': {
      const label = `${path} (setWorldVar)`;
      const { key, value: worldValue } = value;
      if (typeof key !== 'string') fail(`${label} requires a string "key".`);
      if (!isWorldValue(worldValue)) {
        fail(`${label} "value" must be a boolean, number, or string.`);
      }
      return { type: 'setWorldVar', key, value: worldValue };
    }
    case 'teleport': {
      const label = `${path} (teleport)`;
      const { entityId, x, y, facing } = value;
      if (typeof entityId !== 'string') fail(`${label} requires a string "entityId".`);
      if (typeof x !== 'number') fail(`${label} requires a number "x".`);
      if (typeof y !== 'number') fail(`${label} requires a number "y".`);
      if (facing === undefined) {
        return { type: 'teleport', entityId, x, y };
      }
      const parsedFacing = parseCardinalDirection(facing, label, 'facing');
      return { type: 'teleport', entityId, x, y, facing: parsedFacing };
    }
    default:
      fail(`${path} has unknown command type ${JSON.stringify(type)}.`);
  }
}

/**
 * Parses an event script file: `{ version: 1, events: Record<string, EventCommand[]> }`.
 * Defensive over untrusted JSON, mirroring `@threemaker/importer-rpgm`'s `parseMap` —
 * every failure names the offending path (e.g. `events.intro[0]`) and field.
 */
export function parseEventScript(json: unknown): EventScript {
  if (!isRecord(json)) {
    fail(`expected an object, got ${typeof json}.`);
  }

  const { version, events } = json;
  if (version !== 1) {
    fail(`"version" must be 1, got ${JSON.stringify(version)}.`);
  }
  if (!isRecord(events)) {
    fail('"events" must be an object.');
  }

  const result: EventScript = {};
  for (const [eventId, commands] of Object.entries(events)) {
    const path = `events.${eventId}`;
    if (!Array.isArray(commands)) {
      fail(`${path} must be an array of commands.`);
    }
    result[eventId] = commands.map((command, index) =>
      parseEventCommand(command, `${path}[${index}]`),
    );
  }
  return result;
}
