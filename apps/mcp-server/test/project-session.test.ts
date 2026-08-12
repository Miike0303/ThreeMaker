import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProjectSession } from '../src/project-session.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../desktop/test/authored-narrative',
);

describe('ProjectSession', () => {
  it('opens a fixture directory and seeds world state from document worldSeeds', () => {
    const session = new ProjectSession();
    const state = session.openProject(FIXTURE_DIR);
    expect(state.maps).toHaveLength(1);
    expect(state.maps[0]?.relativePath).toBe('current.tmmap.json');
    expect(session.getWorldState('current.tmmap.json')).toMatchObject({
      secret_revealed: false,
    });
  });

  it('creates a blank map and mutates world state', () => {
    const session = new ProjectSession();
    const created = session.createMap({
      relativePath: 'new-map',
      id: 'new-map',
      name: 'New Map',
      width: 8,
      height: 8,
    });
    expect(created.relativePath).toBe('new-map.tmmap.json');
    expect(session.getWorldState('new-map.tmmap.json')).toEqual({});
    expect(session.setWorldState('new-map.tmmap.json', 'doorOpen', true)).toEqual({
      doorOpen: true,
    });
  });

  it('adds a validated event script to a loaded map', () => {
    const session = new ProjectSession();
    session.loadMapDocument(
      'current.tmmap.json',
      readFileSync(join(FIXTURE_DIR, 'current.tmmap.json'), 'utf8'),
    );
    const summary = session.addEvent('current.tmmap.json', 'test-give', [
      { type: 'giveItem', itemId: 'potion', amount: 1 },
    ]);
    expect(summary.id).toBeTruthy();
    const doc = session.getMapDocument('current.tmmap.json');
    expect(doc.events['test-give']).toEqual([{ type: 'giveItem', itemId: 'potion', amount: 1 }]);
  });
});
