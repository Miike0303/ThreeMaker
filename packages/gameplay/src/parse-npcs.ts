import type { Direction } from './grid-mover.js';

// Matches the declared order of the `Direction` union in grid-mover.ts, not
// derived from `DIRECTION_DELTA`'s object key order (which is an unrelated
// implementation detail of that module).
const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];

/** Sprite-sheet reference for an NPC, matching `CharacterSprite`'s sheet/index addressing. */
export interface NpcSprite {
  readonly sheet: string;
  readonly index: number;
}

/** A single NPC entry from an `*.npcs.json` file. */
export interface NpcDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly sprite: NpcSprite;
  /** Event id run when a player interacts with this NPC (see `NpcRegistry#findNpcAt`). */
  readonly onInteract: string;
}

/** Parsed shape of an `*.npcs.json` file: `{ version: 1, npcs: NpcDefinition[] }`. */
export interface NpcFile {
  readonly version: 1;
  readonly npcs: readonly NpcDefinition[];
}

function fail(message: string): never {
  throw new Error(`Invalid NPC JSON: ${message}`);
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

function parseFacing(value: unknown, path: string): Direction {
  if (typeof value !== 'string' || !DIRECTIONS.includes(value as Direction)) {
    fail(`${path} "facing" must be one of ${DIRECTIONS.join(', ')}, got ${JSON.stringify(value)}.`);
  }
  return value as Direction;
}

function parseSprite(value: unknown, path: string): NpcSprite {
  if (!isRecord(value)) {
    fail(`${path} requires a "sprite" object.`);
  }
  const { sheet, index } = value;
  if (typeof sheet !== 'string') {
    fail(`${path} "sprite.sheet" must be a string.`);
  }
  const parsedIndex = parseInteger(index, path, 'sprite.index');
  return { sheet, index: parsedIndex };
}

function parseNpc(value: unknown, path: string): NpcDefinition {
  if (!isRecord(value)) {
    fail(`${path} must be an object.`);
  }
  const { id, x, y, facing, sprite, onInteract } = value;
  if (typeof id !== 'string') fail(`${path} requires a string "id".`);
  const parsedX = parseInteger(x, path, 'x');
  const parsedY = parseInteger(y, path, 'y');
  const parsedFacing = parseFacing(facing, path);
  const parsedSprite = parseSprite(sprite, path);
  if (typeof onInteract !== 'string') fail(`${path} requires a string "onInteract".`);
  return {
    id,
    x: parsedX,
    y: parsedY,
    facing: parsedFacing,
    sprite: parsedSprite,
    onInteract,
  };
}

/**
 * Parses an `*.npcs.json` file: `{ version: 1, npcs: NpcDefinition[] }`.
 * Defensive over untrusted JSON, mirroring `@threemaker/importer-rpgm`'s
 * `parseMap`/core's `parseEventScript` style — every failure names the
 * offending path (e.g. `npcs[0]`) and field.
 */
export function parseNpcs(json: unknown): NpcFile {
  if (!isRecord(json)) {
    fail(`expected an object, got ${typeof json}.`);
  }

  const { version, npcs } = json;
  if (version !== 1) {
    fail(`"version" must be 1, got ${JSON.stringify(version)}.`);
  }
  if (!Array.isArray(npcs)) {
    fail('"npcs" must be an array.');
  }

  const parsed: NpcDefinition[] = [];
  // Tile occupancy is a hard content-authoring invariant: this is a grid
  // game with NPC collision (see NpcRegistry#occupies), so two NPCs on the
  // same tile is a content bug -- one of them would be permanently
  // unreachable. Rejected at parse time rather than left to a runtime
  // surprise, tracking the first npc index that claimed each tile so the
  // error can name both conflicting entries.
  const tileOwner = new Map<string, number>();
  npcs.forEach((npc, index) => {
    const parsedNpc = parseNpc(npc, `npcs[${index}]`);
    const key = `${parsedNpc.x},${parsedNpc.y}`;
    const owner = tileOwner.get(key);
    if (owner !== undefined) {
      fail(
        `npcs[${index}] occupies the same tile (${parsedNpc.x},${parsedNpc.y}) as npcs[${owner}].`,
      );
    }
    tileOwner.set(key, index);
    parsed.push(parsedNpc);
  });

  return { version: 1, npcs: parsed };
}
