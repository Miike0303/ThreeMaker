/** When a tile trigger fires: on tile-arrival, or on a facing-adjacent interact. */
export type TriggerEvent = 'enter' | 'interact';

const TRIGGER_EVENTS: readonly TriggerEvent[] = ['enter', 'interact'];

/** A single trigger entry from an `*.triggers.json` file. */
export interface TriggerDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /**
   * Runtime floor INDEX this trigger sits on (an index into the session's
   * `floors` array, like `StairLinkRuntime.fromFloor`) -- NOT a `.tmmap`
   * floor id. `TriggerIndex` scopes every lookup by it, so a trigger never
   * fires from another floor's same `(x, y)`. `*.triggers.json` has no floor
   * concept, so `parseTriggers` defaults it to `0` (single-floor DEV fixture).
   */
  readonly floor: number;
  readonly on: TriggerEvent;
  /** Event id to run when this trigger fires. */
  readonly event: string;
}

/** Parsed shape of an `*.triggers.json` file: `{ version: 1, triggers: TriggerDefinition[] }`. */
export interface TriggerFile {
  readonly version: 1;
  readonly triggers: readonly TriggerDefinition[];
}

function fail(message: string): never {
  throw new Error(`Invalid Trigger JSON: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInteger(value: unknown, path: string, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${path} "${field}" must be an integer, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function parseTriggerEvent(value: unknown, path: string): TriggerEvent {
  if (typeof value !== 'string' || !TRIGGER_EVENTS.includes(value as TriggerEvent)) {
    fail(`${path} "on" must be one of ${TRIGGER_EVENTS.join(', ')}, got ${JSON.stringify(value)}.`);
  }
  return value as TriggerEvent;
}

function parseTrigger(value: unknown, path: string): TriggerDefinition {
  if (!isRecord(value)) {
    fail(`${path} must be an object.`);
  }
  const { id, x, y, on, event } = value;
  if (typeof id !== 'string') fail(`${path} requires a string "id".`);
  const parsedX = parseInteger(x, path, 'x');
  const parsedY = parseInteger(y, path, 'y');
  const parsedOn = parseTriggerEvent(on, path);
  if (typeof event !== 'string') fail(`${path} requires a string "event".`);
  // The `*.triggers.json` format is single-floor by construction; floor 0
  // keeps it compiling against the floor-aware `TriggerDefinition`.
  return { id, x: parsedX, y: parsedY, floor: 0, on: parsedOn, event };
}

/**
 * Parses an `*.triggers.json` file: `{ version: 1, triggers: TriggerDefinition[] }`.
 * Defensive over untrusted JSON, mirroring `@threemaker/importer-rpgm`'s
 * `parseMap`/core's `parseEventScript` style — every failure names the
 * offending path (e.g. `triggers[0]`) and field.
 */
export function parseTriggers(json: unknown): TriggerFile {
  if (!isRecord(json)) {
    fail(`expected an object, got ${typeof json}.`);
  }

  const { version, triggers } = json;
  if (version !== 1) {
    fail(`"version" must be 1, got ${JSON.stringify(version)}.`);
  }
  if (!Array.isArray(triggers)) {
    fail('"triggers" must be an array.');
  }

  return {
    version: 1,
    triggers: triggers.map((trigger, index) => parseTrigger(trigger, `triggers[${index}]`)),
  };
}
