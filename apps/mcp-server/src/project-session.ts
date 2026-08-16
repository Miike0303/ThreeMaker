import { readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import {
  CommandRegistry,
  createAudioCommandPlugins,
  parseEventScript,
  WorldState,
  type WorldValue,
} from '@threemaker/core';
import type { MapDocument } from '@threemaker/map-format';
import {
  createBlankMapDocument,
  parseMapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import { writeFileAtomic } from './atomic-write.js';
import { inkSidecarRelativePath } from './ink-sidecar-path.js';
import { resolveInsideProject } from './project-paths.js';

const MAP_SUFFIX = '.tmmap.json';
const DEFAULT_FLAGS = new Array(8192).fill(0);
const NO_PROJECT = 'No project is open. Call open_project first.';

/** Parse-only audio plugins so MCP accepts the same verbs as desktop/editor. */
function authoringPlugins(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const plugin of createAudioCommandPlugins()) registry.register(plugin);
  return registry;
}

export type MapSummary = {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly relativePath: string;
  readonly dirty: boolean;
};

export type ProjectSessionState = {
  readonly rootPath: string | null;
  readonly maps: readonly MapSummary[];
};

export type SaveProjectResult = {
  readonly written: readonly string[];
  readonly count: number;
};

export type EditDialogueResult = {
  readonly sidecarPath: string;
  readonly bytesWritten: number;
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

/**
 * In-memory Maker Studio project session for MCP tools. Maps and runtime world
 * state stay headless — no DOM, no Three.js. Disk writes happen only through
 * `saveProject` (map documents) and `editDialogue` (Ink sidecars).
 */
export class ProjectSession {
  private rootPath: string | null = null;
  private readonly documents = new Map<string, MapDocument>();
  private readonly worlds = new Map<string, WorldState>();
  private readonly dirty = new Set<string>();

  openProject(rootPath: string): ProjectSessionState {
    const resolved = resolve(rootPath);
    this.rootPath = resolved;
    this.documents.clear();
    this.worlds.clear();
    this.dirty.clear();

    for (const absolutePath of collectMapFiles(resolved)) {
      const relativePath = mapRelativePath(resolved, absolutePath);
      this.loadMapDocument(relativePath, readFileSync(absolutePath, 'utf8'));
    }

    return this.describe();
  }

  loadMapDocument(relativePath: string, rawJson: string): MapSummary {
    const doc = parseMapDocument(JSON.parse(rawJson), authoringPlugins());
    this.documents.set(relativePath, doc);
    const world = new WorldState();
    seedWorldFromDocument(world, doc.worldSeeds);
    this.worlds.set(relativePath, world);
    this.dirty.delete(relativePath);
    return this.summarize(relativePath, doc);
  }

  describe(): ProjectSessionState {
    return {
      rootPath: this.rootPath,
      maps: [...this.documents.entries()].map(([relativePath, doc]) =>
        this.summarize(relativePath, doc),
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
    const relativePath = this.normalizeMapRelativePath(input.relativePath);
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
    this.dirty.add(relativePath);
    return this.summarize(relativePath, doc);
  }

  getWorldState(relativePath: string): Record<string, WorldValue> {
    const world = this.requireWorld(relativePath);
    return world.snapshot();
  }

  setWorldState(relativePath: string, key: string, value: WorldValue): Record<string, WorldValue> {
    this.requireOpen();
    const world = this.requireWorld(relativePath);
    world.set(key, value);
    const doc = this.requireDocument(relativePath);
    this.documents.set(relativePath, {
      ...doc,
      worldSeeds: { ...doc.worldSeeds, [key]: value },
    });
    this.dirty.add(relativePath);
    return world.snapshot();
  }

  addEvent(relativePath: string, eventKey: string, commands: readonly unknown[]): MapSummary {
    this.requireOpen();
    const doc = this.requireDocument(relativePath);
    const nextEvents = { ...doc.events, [eventKey]: commands };
    const parsed = parseEventScript({ version: 1, events: nextEvents }, authoringPlugins());
    const nextDoc: MapDocument = { ...doc, events: parsed };
    this.documents.set(relativePath, nextDoc);
    this.dirty.add(relativePath);
    return this.summarize(relativePath, nextDoc);
  }

  getMapDocument(relativePath: string): MapDocument {
    return this.requireDocument(relativePath);
  }

  saveProject(): SaveProjectResult {
    const root = this.requireOpen();
    const written: string[] = [];
    for (const relativePath of [...this.dirty].sort()) {
      const doc = this.requireDocument(relativePath);
      const absolutePath = resolveInsideProject(root, relativePath);
      writeFileAtomic(absolutePath, serializeMapDocument(doc));
      this.dirty.delete(relativePath);
      written.push(relativePath);
    }
    return { written, count: written.length };
  }

  editDialogue(relativePath: string, storyId: string, text: string): EditDialogueResult {
    const root = this.requireOpen();
    this.requireDocument(relativePath);
    const sidecarPath = inkSidecarRelativePath(relativePath, storyId).replaceAll('\\', '/');
    const absolutePath = resolveInsideProject(root, sidecarPath);
    writeFileAtomic(absolutePath, text);
    this.dirty.add(relativePath);
    return {
      sidecarPath,
      bytesWritten: Buffer.byteLength(text, 'utf8'),
    };
  }

  private summarize(relativePath: string, doc: MapDocument): MapSummary {
    return {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      relativePath,
      dirty: this.dirty.has(relativePath),
    };
  }

  private normalizeMapRelativePath(relativePath: string): string {
    const withSuffix = relativePath.endsWith(MAP_SUFFIX)
      ? relativePath
      : `${relativePath}${MAP_SUFFIX}`;
    const posix = withSuffix.replaceAll('\\', '/');
    resolveInsideProject(this.requireOpen(), posix);
    return posix;
  }

  private requireOpen(): string {
    if (this.rootPath === null) {
      throw new Error(NO_PROJECT);
    }
    return this.rootPath;
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

function collectMapFiles(rootPath: string): string[] {
  const found: string[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      break;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      const resolved = resolve(absolutePath);
      const rel = relative(rootPath, resolved);
      if (rel.startsWith('..') || isAbsolute(rel) || win32.isAbsolute(rel)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(MAP_SUFFIX)) {
        found.push(resolved);
      }
    }
  }
  return found;
}
