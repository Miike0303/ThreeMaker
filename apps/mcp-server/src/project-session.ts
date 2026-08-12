import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseEventScript, WorldState, type WorldValue } from '@threemaker/core';
import type { MapDocument } from '@threemaker/map-format';
import { createBlankMapDocument, parseMapDocument } from '@threemaker/map-format';

const MAP_SUFFIX = '.tmmap.json';
const DEFAULT_FLAGS = new Array(8192).fill(0);

export type MapSummary = {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly relativePath: string;
};

export type ProjectSessionState = {
  readonly rootPath: string | null;
  readonly maps: readonly MapSummary[];
};

function mapRelativePath(rootPath: string, absolutePath: string): string {
  const normalizedRoot = resolve(rootPath);
  const normalizedFile = resolve(absolutePath);
  if (!normalizedFile.startsWith(normalizedRoot)) {
    return basename(normalizedFile);
  }
  return normalizedFile.slice(normalizedRoot.length + 1).replaceAll('\\', '/');
}

function seedWorldFromDocument(
  world: WorldState,
  seeds: Readonly<Record<string, WorldValue>>,
): void {
  for (const [key, value] of Object.entries(seeds)) {
    if (!world.has(key)) {
      world.set(key, value);
    }
  }
}

function summarizeMap(relativePath: string, doc: MapDocument): MapSummary {
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    relativePath,
  };
}

/**
 * In-memory Maker Studio project session for MCP tools. Maps and runtime world
 * state stay headless — no DOM, no Three.js.
 */
export class ProjectSession {
  private rootPath: string | null = null;
  private readonly documents = new Map<string, MapDocument>();
  private readonly worlds = new Map<string, WorldState>();

  openProject(rootPath: string): ProjectSessionState {
    const resolved = resolve(rootPath);
    this.rootPath = resolved;
    this.documents.clear();
    this.worlds.clear();

    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(MAP_SUFFIX)) {
        continue;
      }
      const absolutePath = join(resolved, entry.name);
      const relativePath = mapRelativePath(resolved, absolutePath);
      this.loadMapDocument(relativePath, readFileSync(absolutePath, 'utf8'));
    }

    return this.describe();
  }

  loadMapDocument(relativePath: string, rawJson: string): MapSummary {
    const doc = parseMapDocument(JSON.parse(rawJson));
    this.documents.set(relativePath, doc);
    const world = new WorldState();
    seedWorldFromDocument(world, doc.worldSeeds);
    this.worlds.set(relativePath, world);
    return summarizeMap(relativePath, doc);
  }

  describe(): ProjectSessionState {
    return {
      rootPath: this.rootPath,
      maps: [...this.documents.entries()].map(([relativePath, doc]) =>
        summarizeMap(relativePath, doc),
      ),
    };
  }

  listMaps(): readonly MapSummary[] {
    return this.describe().maps;
  }

  createMap(input: {
    readonly relativePath: string;
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
  }): MapSummary {
    const relativePath = input.relativePath.endsWith(MAP_SUFFIX)
      ? input.relativePath
      : `${input.relativePath}${MAP_SUFFIX}`;
    if (this.documents.has(relativePath)) {
      throw new Error(`Map already exists at '${relativePath}'.`);
    }

    const doc = createBlankMapDocument({
      id: input.id,
      name: input.name,
      width: input.width,
      height: input.height,
      slots: {},
      flags: DEFAULT_FLAGS,
    });
    this.documents.set(relativePath, doc);
    const world = new WorldState();
    seedWorldFromDocument(world, doc.worldSeeds);
    this.worlds.set(relativePath, world);
    return summarizeMap(relativePath, doc);
  }

  getWorldState(relativePath: string): Record<string, WorldValue> {
    const world = this.requireWorld(relativePath);
    return world.snapshot();
  }

  setWorldState(relativePath: string, key: string, value: WorldValue): Record<string, WorldValue> {
    const world = this.requireWorld(relativePath);
    world.set(key, value);
    const doc = this.requireDocument(relativePath);
    this.documents.set(relativePath, {
      ...doc,
      worldSeeds: { ...doc.worldSeeds, [key]: value },
    });
    return world.snapshot();
  }

  addEvent(relativePath: string, eventKey: string, commands: readonly unknown[]): MapSummary {
    const doc = this.requireDocument(relativePath);
    const nextEvents = { ...doc.events, [eventKey]: commands };
    const parsed = parseEventScript({ version: 1, events: nextEvents });
    const nextDoc: MapDocument = { ...doc, events: parsed };
    this.documents.set(relativePath, nextDoc);
    return summarizeMap(relativePath, nextDoc);
  }

  getMapDocument(relativePath: string): MapDocument {
    return this.requireDocument(relativePath);
  }

  private requireDocument(relativePath: string): MapDocument {
    const doc = this.documents.get(relativePath);
    if (!doc) {
      throw new Error(`Unknown map '${relativePath}'. Call open_project or create_map first.`);
    }
    return doc;
  }

  private requireWorld(relativePath: string): WorldState {
    const world = this.worlds.get(relativePath);
    if (!world) {
      throw new Error(`Unknown map '${relativePath}'. Call open_project or create_map first.`);
    }
    return world;
  }
}
