/**
 * C1b transfer path headless proofs (PLAN_DEV_2 C1 remainder):
 * 1. Authored enter-trigger `transferMap` reaches EventHost (A→B and B→A).
 * 2. World value set on map A survives dispose → build map B and changes
 *    map B's guard dialogue.
 * 3. Transfer landing tile is already-entered so the destination enter
 *    trigger does not bounce the player immediately.
 * 4. Outgoing narrative sprite count is visible to hop-stats at dispose
 *    (debug-panel GPU-leak contract).
 *
 * Full main.ts dispose/rebuild hop is not driven here (DOM/Three session).
 * That path is unit-tested via map-hop policy + exercised by G / transferMap
 * host wiring in main.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardinalDirection, EventHost } from '@threemaker/core';
import { ElevationField } from '@threemaker/gameplay';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { loadAuthoredMap } from '../src/authored-map.js';
import { createHopStats, recordHopCompleted } from '../src/hop-stats.js';
import { buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-transfer');

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/map-a.elder.ink': fixtureText('map-a.elder.ink'),
  '.threemaker/maps/map-b.guard.ink': fixtureText('map-b.guard.ink'),
};

type TransferCall = {
  mapFile: string;
  x: number;
  y: number;
  facing?: CardinalDirection;
};

type Arrival = { readonly x: number; readonly y: number; readonly floor: number };

function makeHost() {
  const transferCalls: TransferCall[] = [];
  const host: EventHost = {
    moveEntity: (_id, _d, _s, done) => done(),
    teleport: vi.fn(),
    transferMap(mapFile, x, y, facing, done) {
      transferCalls.push(facing !== undefined ? { mapFile, x, y, facing } : { mapFile, x, y });
      done();
    },
  };
  return { host, transferCalls };
}

async function loadMap(fileName: string, relativePath: string) {
  return loadAuthoredMap({
    mapRelativePath: relativePath,
    readMapDocumentText: async () => fixtureText(fileName),
    readSidecarText: async (path) => SIDECARS[path] ?? null,
    resolveObjectTexture: async () => {
      throw new Error('fixture authors no tileset slot');
    },
  });
}

async function boot(
  mapFile: string,
  relativePath: string,
  host: EventHost,
  root = createRoot(),
  arrivalOverride?: Arrival,
) {
  const authored = await loadMap(mapFile, relativePath);
  if (!authored?.spawn || !authored.narrative) {
    throw new Error(`${mapFile} must load with spawn + narrative`);
  }
  const arrival =
    arrivalOverride ??
    ({ x: authored.spawn.x, y: authored.spawn.y, floor: authored.spawn.floorIndex } as const);
  const bundle = await buildMapNarrativeBundle({
    narrative: authored.narrative,
    root,
    host,
    scene: new THREE.Scene(),
    floors: [
      { elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))), baseElevation: 0 },
    ],
    arrival,
    resolveObjectTexture: async () => ({
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    }),
    tileWorldSize: 1,
    heightUnit: 1,
  });
  if (!bundle) throw new Error(`${mapFile} must build a narrative bundle`);
  return { authored, bundle, root };
}

function createRoot() {
  return createNarrativeRoot({
    createOverlay: () => {
      throw new Error('headless: overlay must not build');
    },
  });
}

describe('authored transferMap (C1b)', () => {
  it('enter-trigger event transferMap reaches the host with mapFile and arrival', async () => {
    const { host, transferCalls } = makeHost();
    const { bundle } = await boot('map-a.tmmap.json', '.threemaker/maps/map-a.tmmap.json', host);

    // TriggerIndex stores EVENT ids (content keys), not trigger document ids.
    expect(bundle.triggerIndex.enter(0, 5, 2)).toEqual(['go_to_b']);
    const script = bundle.events.go_to_b;
    expect(script?.[0]).toMatchObject({
      type: 'transferMap',
      mapFile: 'map-b.tmmap.json',
      x: 1,
      y: 1,
      facing: 'down',
    });

    bundle.interpreter.run(script ?? []);
    expect(transferCalls).toEqual([{ mapFile: 'map-b.tmmap.json', x: 1, y: 1, facing: 'down' }]);
    expect(bundle.interpreter.state).toBe('idle');
  });

  it('world secret set on map A survives dispose and changes map B guard dialogue', async () => {
    const { host } = makeHost();
    const root = createRoot();
    const a = await boot('map-a.tmmap.json', '.threemaker/maps/map-a.tmmap.json', host, root);

    a.bundle.interpreter.run(a.bundle.events.elder_intro ?? []);
    a.bundle.interpreter.advance();
    a.bundle.interpreter.choose(0);
    expect(root.world.get('secret_revealed')).toBe(true);

    a.bundle.dispose();
    const b = await boot('map-b.tmmap.json', '.threemaker/maps/map-b.tmmap.json', host, root);

    const lines: string[] = [];
    b.bundle.interpreter.signals.on('dialogue:line', (payload) => {
      lines.push(payload.text);
    });
    b.bundle.interpreter.run(b.bundle.events.guard_check ?? []);
    expect(lines.some((line) => line.includes('elder told you'))).toBe(true);
    expect(lines.some((line) => line.includes('Halt!'))).toBe(false);
  });

  it('map B return transfer reaches the host (bidirectional A↔B loop)', async () => {
    const { host, transferCalls } = makeHost();
    const { bundle } = await boot('map-b.tmmap.json', '.threemaker/maps/map-b.tmmap.json', host);

    expect(bundle.triggerIndex.enter(0, 0, 3)).toEqual(['go_to_a']);
    bundle.interpreter.run(bundle.events.go_to_a ?? []);
    expect(transferCalls).toEqual([{ mapFile: 'map-a.tmmap.json', x: 2, y: 2, facing: 'up' }]);
  });

  it('transfer landing tile is already entered (no immediate re-fire bounce)', async () => {
    const { host } = makeHost();
    // transferMap from A lands at (1,1) on B — same coords as B's authored spawn.
    // Boot as a hop would: arrival = transfer coords, not a later walk-on.
    const b = await boot(
      'map-b.tmmap.json',
      '.threemaker/maps/map-b.tmmap.json',
      host,
      createRoot(),
      {
        x: 1,
        y: 1,
        floor: 0,
      },
    );

    expect(b.bundle.triggerIndex.enter(0, 1, 1)).toEqual([]);
    // A different enter trigger still fires after the player walks off arrival.
    expect(b.bundle.triggerIndex.enter(0, 0, 3)).toEqual(['go_to_a']);
  });

  /**
   * PLAN_DEV_2 C1 exit chain (headless): ink decision on A → world flag →
   * transfer command → dispose A (hop-stats see outgoing sprites) → B reads
   * flag → B can transfer back.
   */
  it('C1 exit chain: dialogue, world, hop-stats dispose counts, return transfer', async () => {
    const { host, transferCalls } = makeHost();
    const root = createRoot();
    const a = await boot('map-a.tmmap.json', '.threemaker/maps/map-a.tmmap.json', host, root);

    a.bundle.interpreter.run(a.bundle.events.elder_intro ?? []);
    a.bundle.interpreter.advance(); // welcome line → choices
    a.bundle.interpreter.choose(0); // reveal secret → follow-up line
    a.bundle.interpreter.advance(); // follow-up line → dialogue end (idle)
    expect(root.world.get('secret_revealed')).toBe(true);
    expect(a.bundle.interpreter.state).toBe('idle');

    a.bundle.interpreter.run(a.bundle.events.go_to_b ?? []);
    expect(transferCalls).toEqual([{ mapFile: 'map-b.tmmap.json', x: 1, y: 1, facing: 'down' }]);

    const hopStats = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: a.bundle.sprites.length,
      outgoingFloorTextureKeys: 0,
    });
    expect(hopStats.hopsCompleted).toBe(1);
    expect(hopStats.lastOutgoingNarrativeSprites).toBe(1); // elder

    a.bundle.dispose();
    const b = await boot('map-b.tmmap.json', '.threemaker/maps/map-b.tmmap.json', host, root, {
      x: 1,
      y: 1,
      floor: 0,
    });

    const lines: string[] = [];
    b.bundle.interpreter.signals.on('dialogue:line', (payload) => {
      lines.push(payload.text);
    });
    b.bundle.interpreter.run(b.bundle.events.guard_check ?? []);
    expect(lines.some((line) => line.includes('elder told you'))).toBe(true);
    b.bundle.interpreter.advance(); // close single guard line → idle
    expect(b.bundle.interpreter.state).toBe('idle');

    b.bundle.interpreter.run(b.bundle.events.go_to_a ?? []);
    expect(transferCalls).toEqual([
      { mapFile: 'map-b.tmmap.json', x: 1, y: 1, facing: 'down' },
      { mapFile: 'map-a.tmmap.json', x: 2, y: 2, facing: 'up' },
    ]);
    expect(root.world.get('secret_revealed')).toBe(true);
  });
});
