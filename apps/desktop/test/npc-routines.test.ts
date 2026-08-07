/**
 * C7 WU-03: NPC day-routine execution — teleports at minute boundaries,
 * dialogue gate, lantern follow, evening boot placement, interact-after-move.
 *
 * Headless, bootSession-style (mirrors stats-inventory-exit-criterion): real
 * loader + buildMapNarrativeBundle, no GUI / main.ts loop.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventHost } from '@threemaker/core';
import { WorldClock } from '@threemaker/core';
import type { Direction } from '@threemaker/gameplay';
import { ElevationField } from '@threemaker/gameplay';
import type { LightDocument } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoredMapNarrative } from '../src/authored-map.js';
import { loadAuthoredMap } from '../src/authored-map.js';
import { tileCenterToWorld } from '../src/character-sprite.js';
import { groundYAt } from '../src/ground-y.js';
import type { MapLightsBundle } from '../src/map-lights.js';
import { buildMapLights } from '../src/map-lights.js';
import type { MapNarrativeBundle, MapNarrativeBundleDeps } from '../src/map-narrative-bundle.js';
import { applyRoutinesIfIdle, buildMapNarrativeBundle } from '../src/map-narrative-bundle.js';
import type { NarrativeRoot } from '../src/narrative-root.js';
import { createNarrativeRoot } from '../src/narrative-root.js';
import { buildMap } from './fixtures.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'authored-narrative');
const MAP_RELATIVE_PATH = '.threemaker/maps/current.tmmap.json';

type RawDoc = Record<string, unknown>;

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURE_DIR, fileName), 'utf8');
}

const SIDECARS: Readonly<Record<string, string>> = {
  '.threemaker/maps/current.elder.ink': fixtureText('current.elder.ink'),
  '.threemaker/maps/current.guard.ink': fixtureText('current.guard.ink'),
  '.threemaker/maps/current.welcome.ink': fixtureText('current.welcome.ink'),
};

function fixtureDoc(): RawDoc {
  return JSON.parse(fixtureText('current.tmmap.json')) as RawDoc;
}

/** Elder base (1,1); stop at 720 → (3,3); stop at 1200 → (5,2). Guard has no routine. */
const ELDER_ROUTINE = [
  { at: 720, x: 3, y: 3, facing: 'up' as const },
  { at: 1200, x: 5, y: 2, facing: 'left' as const },
];

async function narrativeWithElderRoutine(overrides: RawDoc = {}): Promise<AuthoredMapNarrative> {
  const doc = fixtureDoc();
  const npcs = (doc.npcs as RawDoc[]).map((npc) =>
    npc.id === 'elder' ? { ...npc, routine: ELDER_ROUTINE } : npc,
  );
  const result = await loadAuthoredMap({
    mapRelativePath: MAP_RELATIVE_PATH,
    readMapDocumentText: async () => JSON.stringify({ ...doc, npcs, ...overrides }),
    readSidecarText: async (path) => SIDECARS[path] ?? null,
    resolveObjectTexture: async () => {
      throw new Error('the fixture authors no tileset slot');
    },
  });
  if (!result?.narrative) throw new Error('the fixture must author narrative');
  return result.narrative;
}

const HOST: EventHost = {
  moveEntity: vi.fn(),
  teleport: vi.fn(),
  transferMap: vi.fn((_f, _x, _y, _facing, done: () => void) => done()),
};

function floorAt(height: number, baseElevation: number) {
  return {
    elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(height))),
    baseElevation,
  };
}

function createRoot(): NarrativeRoot {
  return createNarrativeRoot({
    createOverlay: () => {
      throw new Error('headless: no overlay');
    },
    clock: new WorldClock({ minutesPerRealSecond: 1 }),
  });
}

async function bootBundle(overrides: Partial<MapNarrativeBundleDeps> = {}): Promise<{
  readonly bundle: MapNarrativeBundle;
  readonly root: NarrativeRoot;
  readonly scene: THREE.Scene;
  readonly floors: ReturnType<typeof floorAt>[];
}> {
  const root = createRoot();
  const scene = new THREE.Scene();
  const floors = [floorAt(0, 0)];
  const narrative = overrides.narrative ?? (await narrativeWithElderRoutine());
  const bundle = await buildMapNarrativeBundle({
    root,
    host: HOST,
    scene,
    floors,
    arrival: { x: 2, y: 2, floor: 0 },
    resolveObjectTexture: async () => ({
      texture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    }),
    tileWorldSize: 1,
    heightUnit: 1,
    minutes: 480,
    ...overrides,
    narrative,
  });
  if (!bundle) throw new Error('expected narrative bundle');
  return { bundle, root, scene, floors };
}

function elderSprite(bundle: MapNarrativeBundle) {
  // Authored order: elder first, guard second.
  const sprite = bundle.sprites[0];
  if (!sprite) throw new Error('expected elder sprite');
  return sprite;
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
  while (
    bundle.interpreter.state === 'waiting-for-dialogue' ||
    bundle.interpreter.state === 'waiting-for-choice'
  ) {
    if (bundle.interpreter.state === 'waiting-for-choice') {
      bundle.interpreter.choose(0);
    } else {
      bundle.interpreter.advance();
    }
  }
}

describe('applyRoutines — minute-boundary teleports', () => {
  it('at build minute 480 places the routined NPC at base; applyRoutines(1200) moves registry + sprite', async () => {
    const heightUnit = 1;
    const floors = [floorAt(2, 1)]; // groundY = (1+2)*1 = 3
    const { bundle } = await bootBundle({ floors, heightUnit, minutes: 480 });

    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)?.id).toBe('elder');
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)).toBeUndefined();
    // Guard (no routine) still at authored tile.
    expect(bundle.npcRegistry.findNpcAt(0, 4, 4)?.id).toBe('guard');

    const moved = bundle.applyRoutines(1200);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.npcId).toBe('elder');
    expect(moved[0]?.position).toEqual({ x: 5, y: 2, groundY: 3 });

    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)).toBeUndefined();
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)?.id).toBe('elder');
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)?.facing).toBe('left');
    // Guard untouched.
    expect(bundle.npcRegistry.findNpcAt(0, 4, 4)?.id).toBe('guard');

    const sprite = elderSprite(bundle);
    expect(sprite.mesh.position.x).toBeCloseTo(tileCenterToWorld(5, 1));
    expect(sprite.mesh.position.z).toBeCloseTo(tileCenterToWorld(2, 1));
    expect(sprite.mesh.position.y).toBeCloseTo(3);
  });

  it('applyRoutines at the same minute is idempotent (0 moves)', async () => {
    const { bundle } = await bootBundle({ minutes: 480 });
    expect(bundle.applyRoutines(1200)).toHaveLength(1);
    expect(bundle.applyRoutines(1200)).toHaveLength(0);
  });

  it('evening build (minutes 1200) places the NPC at its 1200 stop immediately', async () => {
    const floors = [floorAt(0, 0)];
    const { bundle } = await bootBundle({ floors, minutes: 1200 });

    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)).toBeUndefined();
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)?.id).toBe('elder');
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)?.facing).toBe('left');

    const floor0 = floors[0];
    if (!floor0) throw new Error('expected floor');
    const expectedY = groundYAt(floor0.elevation, 5, 2, 1, floor0.baseElevation);
    expect(elderSprite(bundle).mesh.position.y).toBeCloseTo(expectedY);
    // Already at the stop — no further moves.
    expect(bundle.applyRoutines(1200)).toHaveLength(0);
  });
});

describe('applyRoutinesIfIdle — dialogue gate', () => {
  it('skips while the interpreter is mid-dialogue; next idle application catches up', async () => {
    const { bundle } = await bootBundle({ minutes: 480 });
    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)?.id).toBe('elder');

    // Start elder dialogue (still at base tile).
    pressInteract(bundle, { x: 1, y: 2, facing: 'up', floor: 0 });
    expect(bundle.interpreter.state).not.toBe('idle');

    // Crossed-minute path would call this: skip while dialogue runs.
    expect(applyRoutinesIfIdle(bundle, 1200)).toHaveLength(0);
    expect(bundle.npcRegistry.findNpcAt(0, 1, 1)?.id).toBe('elder');
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)).toBeUndefined();

    finishDialogue(bundle);
    expect(bundle.interpreter.state).toBe('idle');

    // routinePositionAt is absolute — next application self-heals to the 1200 stop.
    const moved = applyRoutinesIfIdle(bundle, 1200);
    expect(moved).toHaveLength(1);
    expect(bundle.npcRegistry.findNpcAt(0, 5, 2)?.id).toBe('elder');
  });
});

describe('interact after routine move', () => {
  it('npcAdjacentFacing resolves the NPC at the NEW tile and runs its event', async () => {
    const { bundle } = await bootBundle({ minutes: 480 });
    bundle.applyRoutines(1200);

    // Stand south of (5,2), face up → elder at new stop.
    const lines: string[] = [];
    bundle.interpreter.signals.on('dialogue:line', (event) => lines.push(event.text));
    pressInteract(bundle, { x: 5, y: 3, facing: 'up', floor: 0 });
    expect(bundle.interpreter.state).not.toBe('idle');
    expect(lines.length).toBeGreaterThan(0);

    // Old tile no longer interactable as elder.
    finishDialogue(bundle);
    pressInteract(bundle, { x: 1, y: 2, facing: 'up', floor: 0 });
    expect(bundle.interpreter.state).toBe('idle');
  });
});

describe('MapLightsBundle.updateNpc — lantern follow', () => {
  function lanternBundle(
    npcPositions: Map<string, { x: number; y: number; floor: number; groundY: number }>,
  ) {
    const scene = new THREE.Scene();
    const lights: readonly LightDocument[] = [
      {
        id: 'lantern',
        kind: 'point',
        color: '#ffcc00',
        intensity: 1,
        range: 4,
        attach: 'elder',
      },
      {
        id: 'torch',
        kind: 'point',
        color: '#ffffff',
        intensity: 1,
        range: 5,
        attach: 'player',
      },
    ];
    const bundle = buildMapLights({
      lights,
      scene,
      floors: [
        {
          floorId: 'floor-0',
          elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(0))),
          baseElevation: 0,
        },
      ],
      tileWorldSize: 1,
      heightUnit: 2,
      npcPositions,
    });
    if (!bundle) throw new Error('expected lights');
    return { bundle, scene };
  }

  function lightNamed(scene: THREE.Scene, index: number): THREE.Light {
    const group = scene.children.find((c) => c.name === 'map-lights');
    if (!group) throw new Error('expected map-lights group');
    const light = group.children.filter((c) => (c as THREE.Light).isLight)[index] as
      | THREE.Light
      | undefined;
    if (!light) throw new Error(`expected light at ${index}`);
    return light;
  }

  it('moves the NPC lantern with updateNpc after a routine move; updatePlayer unaffected; unknown id no-op', () => {
    const heightUnit = 2;
    const npcPositions = new Map([['elder', { x: 1, y: 1, floor: 0, groundY: 0 }]]);
    const { bundle, scene } = lanternBundle(npcPositions);
    const lantern = lightNamed(scene, 0);
    const torch = lightNamed(scene, 1);

    const initialLantern = lantern.position.clone();
    const initialTorch = torch.position.clone();

    // Unknown npcId is a no-op.
    bundle.updateNpc('ghost', new THREE.Vector3(99, 0, 99));
    expect(lantern.position.equals(initialLantern)).toBe(true);

    // Routine move → lantern follows sprite base + attach offset.
    const world = new THREE.Vector3(tileCenterToWorld(5, 1), 3, tileCenterToWorld(2, 1));
    bundle.updateNpc('elder', world);
    expect(lantern.position.x).toBeCloseTo(world.x);
    expect(lantern.position.z).toBeCloseTo(world.z);
    expect(lantern.position.y).toBeCloseTo(world.y + 0.5 * heightUnit);

    // Player torch untouched by updateNpc.
    expect(torch.position.equals(initialTorch)).toBe(true);

    // updatePlayer still moves only player-attached lights.
    bundle.updatePlayer(new THREE.Vector3(10, 4, 12));
    expect(torch.position.x).toBeCloseTo(10);
    expect(torch.position.y).toBeCloseTo(4 + 0.5 * heightUnit);
    expect(torch.position.z).toBeCloseTo(12);
    expect(lantern.position.x).toBeCloseTo(world.x);
  });

  it('wires routine move → updateNpc through the same shape main.ts uses', async () => {
    const heightUnit = 1;
    const floors = [floorAt(0, 0)];
    const { bundle } = await bootBundle({ floors, heightUnit, minutes: 480 });

    const scene = new THREE.Scene();
    const floor0 = floors[0];
    if (!floor0) throw new Error('expected floor');
    const lights: MapLightsBundle | undefined = buildMapLights({
      lights: [
        {
          id: 'lantern',
          kind: 'point',
          color: '#ffcc00',
          intensity: 1,
          range: 4,
          attach: 'elder',
        },
      ],
      scene,
      floors: [{ floorId: 'floor-0', ...floor0 }],
      tileWorldSize: 1,
      heightUnit,
      npcPositions: new Map([['elder', { x: 1, y: 1, floor: 0, groundY: 0 }]]),
    });
    if (!lights) throw new Error('expected lights');

    const lantern = lightNamed(scene, 0);
    const moved = bundle.applyRoutines(1200);
    for (const m of moved) {
      lights.updateNpc(
        m.npcId,
        new THREE.Vector3(
          tileCenterToWorld(m.position.x, 1),
          m.position.groundY,
          tileCenterToWorld(m.position.y, 1),
        ),
      );
    }
    expect(lantern.position.x).toBeCloseTo(tileCenterToWorld(5, 1));
    expect(lantern.position.z).toBeCloseTo(tileCenterToWorld(2, 1));
    expect(lantern.position.y).toBeCloseTo(0 + 0.5 * heightUnit);
  });
});
