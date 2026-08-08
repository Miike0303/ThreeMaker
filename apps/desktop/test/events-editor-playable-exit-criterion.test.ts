/**
 * L1 exit criterion — **play half**: a map document shaped exactly like the
 * editor form-path exit criterion (`events-editor-exit-criterion.test.ts`)
 * loads through the authored runtime seams and runs
 * giveItem + showDialogue + conditional.
 *
 * Fixture is hand-checked against the editor compose output shape (same keys,
 * same command tree). No GUI here; proves the save artifact is playable.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { WorldClock } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField, Inventory, parseGameDefsJson, StatBlock } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapResult, GameDefsCatalog } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import type { MapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'events-editor-playable');
const MAP_RELATIVE_PATH = '.threemaker/maps/form-authored.tmmap.json';

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const HOST: EventHost = {
  moveEntity: (_entityId, _direction, _steps, done) => done(),
  teleport: vi.fn(),
  transferMap: (_mapFile, _x, _y, _facing, done) => done(),
};

const GAME_DEFS = parseGameDefsJson(fixtureText('game-defs.json'));
const GAME_DEFS_CATALOG: GameDefsCatalog = {
  itemIds: new Set(GAME_DEFS.items.map((item) => item.id)),
  statIds: new Set(GAME_DEFS.stats.map((stat) => stat.id)),
};

function loadFixtureMap(): Promise<AuthoredMapResult | null> {
  return loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    gameDefsCatalog: GAME_DEFS_CATALOG,
    readMapDocumentText: async () => fixtureText('form-authored.tmmap.json'),
    readSidecarText: async () => null,
    resolveObjectTexture: async () => {
      throw new Error('fixture authors no tileset slot');
    },
  });
}

async function bootSession(): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: ReturnType<typeof createNarrativeRoot>;
}> {
  const authored = await loadFixtureMap();
  if (!authored) throw new Error('form-authored fixture must load');
  const spawn = authored.spawn;
  if (!spawn) throw new Error('form-authored fixture must author a spawn');

  const root = createNarrativeRoot({
    createOverlay: () => {
      throw new Error('a headless run must never build the session overlay');
    },
    inventory: new Inventory(),
    stats: new StatBlock(GAME_DEFS.stats),
    clock: new WorldClock({ minutesPerRealSecond: 1 }),
  });

  const bundle = await buildMapNarrativeBundle({
    narrative: authored.narrative,
    root,
    host: HOST,
    scene: new THREE.Scene(),
    floors: [
      { elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))), baseElevation: 0 },
    ],
    arrival: { x: spawn.x, y: spawn.y, floor: spawn.floorIndex },
    resolveObjectTexture: async () => ({
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    }),
    tileWorldSize: 1,
    heightUnit: 1,
  });
  if (!bundle) throw new Error('form-authored fixture must author narrative');
  return { bundle, root };
}

function pressInteract(
  bundle: MapNarrativeBundle,
  at: {
    readonly x: number;
    readonly y: number;
    readonly facing: Direction;
    readonly floor: number;
  },
): void {
  const npc = bundle.npcRegistry.npcAdjacentFacing(at.floor, at.x, at.y, at.facing);
  if (npc) {
    bundle.interpreter.run(bundle.events[npc.onInteract] ?? []);
    return;
  }
  for (const eventId of bundle.triggerIndex.interact(at.floor, at.x, at.y, at.facing)) {
    bundle.interpreter.run(bundle.events[eventId] ?? []);
  }
}

function finishDialogue(bundle: MapNarrativeBundle): void {
  while (bundle.interpreter.state === 'waiting-for-dialogue') bundle.interpreter.advance();
}

const AT_CHEST = { x: 2, y: 1, facing: 'left' as const, floor: 0 };
const AT_GREETER = { x: 4, y: 3, facing: 'down' as const, floor: 0 };

describe('exit criterion: form-authored events play in desktop runtime', () => {
  it('chest conditional gives item once; greeter showDialogue lines fire', async () => {
    const { bundle, root } = await bootSession();
    const lines: string[] = [];
    const failed = vi.fn();
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    bundle.interpreter.signals.on('script:failed', failed);

    pressInteract(bundle, AT_GREETER);
    finishDialogue(bundle);
    expect(lines).toEqual(['Welcome!', 'Stay a while.']);

    pressInteract(bundle, AT_CHEST);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('You found a brass key.');
    expect(root.inventory.count('brass_key')).toBe(1);
    expect(root.world.get('chest_opened')).toBe(true);

    pressInteract(bundle, AT_CHEST);
    finishDialogue(bundle);
    expect(lines.at(-1)).toBe('The chest is empty.');
    expect(root.inventory.count('brass_key')).toBe(1);

    expect(failed).not.toHaveBeenCalled();
    expect(bundle.interpreter.state).toBe('idle');
  });
});
