/**
 * C1b transfer path headless proofs:
 * 1. Authored enter-trigger event containing `transferMap` reaches EventHost.
 * 2. World value set on map A is still readable after dispose → build map B
 *    (session-scoped WorldState), and map B's guard dialogue branches on it.
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

async function boot(mapFile: string, relativePath: string, host: EventHost, root = createRoot()) {
  const authored = await loadMap(mapFile, relativePath);
  if (!authored?.spawn || !authored.narrative) {
    throw new Error(`${mapFile} must load with spawn + narrative`);
  }
  const bundle = await buildMapNarrativeBundle({
    narrative: authored.narrative,
    root,
    host,
    scene: new THREE.Scene(),
    floors: [
      { elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))), baseElevation: 0 },
    ],
    arrival: { x: authored.spawn.x, y: authored.spawn.y, floor: authored.spawn.floorIndex },
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
});
