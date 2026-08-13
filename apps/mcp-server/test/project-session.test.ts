import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBlankMapDocument,
  parseMapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSession } from '../src/project-session.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../desktop/test/authored-narrative',
);

const DEFAULT_FLAGS = new Array(8192).fill(0);

const temps: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-mcp-session-'));
  temps.push(root);
  return root;
}

function blankJson(id = 'blank'): string {
  return serializeMapDocument(
    createBlankMapDocument({
      id,
      name: id,
      width: 8,
      height: 8,
      slots: {},
      flags: DEFAULT_FLAGS,
    }),
  );
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ProjectSession', () => {
  it('opens a fixture directory and seeds world state from document worldSeeds', () => {
    const session = new ProjectSession();
    const state = session.openProject(FIXTURE_DIR);
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0]?.relativePath).toBe('current.tmmap.json');
    expect(state.maps[0]?.dirty).toBe(false);
    expect(session.getWorldState('current.tmmap.json')).toMatchObject({
      secret_revealed: false,
    });
  });

  it('creates a blank map and mutates world state', () => {
    const session = new ProjectSession();
    session.openProject(makeRoot());
    const created = session.createMap({
      relativePath: 'new-map',
      id: 'new-map',
      name: 'New Map',
      width: 8,
      height: 8,
    });
    expect(created.relativePath).toBe('new-map.tmmap.json');
    expect(created.dirty).toBe(true);
    expect(session.getWorldState('new-map.tmmap.json')).toEqual({});
    expect(session.setWorldState('new-map.tmmap.json', 'doorOpen', true)).toEqual({
      doorOpen: true,
    });
  });

  it('adds a validated event script to a loaded map', () => {
    const session = new ProjectSession();
    session.openProject(makeRoot());
    session.loadMapDocument(
      'current.tmmap.json',
      readFileSync(join(FIXTURE_DIR, 'current.tmmap.json'), 'utf8'),
    );
    const summary = session.addEvent('current.tmmap.json', 'test-give', [
      { type: 'giveItem', itemId: 'potion', amount: 1 },
    ]);
    expect(summary.id).toBeTruthy();
    expect(summary.dirty).toBe(true);
    const doc = session.getMapDocument('current.tmmap.json');
    expect(doc.events['test-give']).toEqual([{ type: 'giveItem', itemId: 'potion', amount: 1 }]);
  });

  it('save_project before open_project errors instead of writing', () => {
    const session = new ProjectSession();
    session.loadMapDocument('evil.tmmap.json', blankJson('evil'));
    expect(() => session.saveProject()).toThrow(/open_project/i);
    expect(existsSync(join(process.cwd(), 'evil.tmmap.json'))).toBe(false);
  });

  it('refuses create_map, set_world_state, add_event, and edit_dialogue before open_project', () => {
    const session = new ProjectSession();
    expect(() =>
      session.createMap({
        relativePath: 'ghost',
        id: 'ghost',
        name: 'Ghost',
        width: 8,
        height: 8,
      }),
    ).toThrow(/open_project/i);
    session.loadMapDocument('ghost.tmmap.json', blankJson('ghost'));
    expect(() => session.setWorldState('ghost.tmmap.json', 'k', true)).toThrow(/open_project/i);
    expect(() =>
      session.addEvent('ghost.tmmap.json', 'e', [
        { type: 'giveItem', itemId: 'potion', amount: 1 },
      ]),
    ).toThrow(/open_project/i);
    expect(() => session.editDialogue('ghost.tmmap.json', 'intro', 'Hello')).toThrow(
      /open_project/i,
    );
    expect(existsSync(join(process.cwd(), 'ghost.intro.ink'))).toBe(false);
  });

  it('rejects a .. traversal relativePath on create_map and does not write', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    expect(() =>
      session.createMap({
        relativePath: '../pwned',
        id: 'pwned',
        name: 'Pwned',
        width: 8,
        height: 8,
      }),
    ).toThrow(/project root/i);
    expect(existsSync(join(root, '..', 'pwned.tmmap.json'))).toBe(false);
  });

  it('rejects save_project when a loaded map path would escape the project root', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    session.loadMapDocument('../outside.tmmap.json', blankJson('outside'));
    session.setWorldState('../outside.tmmap.json', 'x', true);
    expect(() => session.saveProject()).toThrow(/project root/i);
    expect(existsSync(join(root, '..', 'outside.tmmap.json'))).toBe(false);
  });

  it('list_maps reports dirty after mutating tools and clean after save_project', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    expect(session.listMaps()).toEqual([]);

    session.createMap({
      relativePath: 'keep',
      id: 'keep',
      name: 'Keep',
      width: 8,
      height: 8,
    });
    expect(session.listMaps().map((map) => ({ path: map.relativePath, dirty: map.dirty }))).toEqual(
      [{ path: 'keep.tmmap.json', dirty: true }],
    );

    session.setWorldState('keep.tmmap.json', 'lit', true);
    session.addEvent('keep.tmmap.json', 'on-enter', [
      { type: 'giveItem', itemId: 'potion', amount: 1 },
    ]);
    expect(session.listMaps()[0]?.dirty).toBe(true);

    const saved = session.saveProject();
    expect(saved.written).toEqual(['keep.tmmap.json']);
    expect(saved.count).toBe(1);
    expect(session.listMaps()[0]?.dirty).toBe(false);

    const onDisk = parseMapDocument(
      JSON.parse(readFileSync(join(root, 'keep.tmmap.json'), 'utf8')),
    );
    expect(onDisk.worldSeeds).toEqual({ lit: true });
    expect(onDisk.events['on-enter']).toEqual([{ type: 'giveItem', itemId: 'potion', amount: 1 }]);

    expect(session.saveProject()).toEqual({ written: [], count: 0 });
  });

  it('does not write map files until save_project (no autosave)', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    session.createMap({
      relativePath: 'forest',
      id: 'forest',
      name: 'Forest',
      width: 8,
      height: 8,
    });
    session.setWorldState('forest.tmmap.json', 'x', 1);
    expect(readdirSync(root)).toEqual([]);
  });

  it('save_project writes nested map paths and a later open_project reloads them', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    session.createMap({
      relativePath: 'demo/forest',
      id: 'forest',
      name: 'Forest',
      width: 8,
      height: 8,
    });
    session.saveProject();
    expect(existsSync(join(root, 'demo', 'forest.tmmap.json'))).toBe(true);

    const reopened = new ProjectSession();
    const state = reopened.openProject(root);
    expect(state.maps.map((map) => map.relativePath)).toEqual(['demo/forest.tmmap.json']);
    expect(state.maps[0]?.dirty).toBe(false);
    expect(state.maps[0]?.id).toBe('forest');
  });

  it('edit_dialogue writes the editor-convention sidecar and reports utf8 byte length', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    session.createMap({
      relativePath: 'current',
      id: 'current',
      name: 'Current',
      width: 8,
      height: 8,
    });
    const text = '=== start ===\nCafé\n';
    const result = session.editDialogue('current.tmmap.json', 'intro', text);
    expect(result.sidecarPath).toBe('current.intro.ink');
    expect(result.bytesWritten).toBe(Buffer.byteLength(text, 'utf8'));
    expect(result.bytesWritten).toBeGreaterThan(text.length);
    expect(readFileSync(join(root, 'current.intro.ink'), 'utf8')).toBe(text);
    expect(session.listMaps()[0]?.dirty).toBe(true);
  });

  it('edit_dialogue rejects an unknown map and an unsafe story id', () => {
    const root = makeRoot();
    const session = new ProjectSession();
    session.openProject(root);
    session.createMap({
      relativePath: 'town',
      id: 'town',
      name: 'Town',
      width: 8,
      height: 8,
    });
    expect(() => session.editDialogue('missing.tmmap.json', 'intro', 'x')).toThrow(/Unknown map/);
    expect(() => session.editDialogue('town.tmmap.json', '../evil', 'x')).toThrow(/story id/i);
    expect(existsSync(join(root, 'town../evil.ink'))).toBe(false);
  });
});
