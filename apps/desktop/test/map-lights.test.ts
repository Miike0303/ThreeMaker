/**
 * Per-map authored lights runtime (C6 WU-03): budget gate, placement, attach,
 * spot aim-down, disposal, hop-stats counter.
 */
import { ElevationField } from '@threemaker/gameplay';
import type { LightDocument } from '@threemaker/map-format';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { tileCenterToWorld } from '../src/character-sprite.js';
import { createHopStats, recordHopCompleted } from '../src/hop-stats.js';
import { LIGHT_BUDGET } from '../src/light-budget.js';
import type { MapLightsBundleDeps, NpcLightAnchor } from '../src/map-lights.js';
import { assertLightBudget, buildMapLights } from '../src/map-lights.js';
import { buildMap } from './fixtures.js';

function floorAt(height: number, baseElevation: number, floorId = 'floor-0') {
  return {
    floorId,
    elevation: new ElevationField(buildMap(6, 6, new Array(36).fill(height))),
    baseElevation,
  };
}

function pointLight(overrides: Partial<LightDocument> & Pick<LightDocument, 'id'>): LightDocument {
  return {
    kind: 'point',
    color: '#ffaa00',
    intensity: 1.5,
    range: 8,
    x: 1,
    y: 2,
    floor: 'floor-0',
    ...overrides,
  };
}

function spotLight(overrides: Partial<LightDocument> & Pick<LightDocument, 'id'>): LightDocument {
  return {
    kind: 'spot',
    color: '#ffffff',
    intensity: 2,
    range: 10,
    x: 0,
    y: 0,
    floor: 'floor-0',
    ...overrides,
  };
}

function build(
  lights: readonly LightDocument[],
  overrides: Partial<MapLightsBundleDeps> = {},
  shared: { scene?: THREE.Scene } = {},
) {
  const scene = shared.scene ?? new THREE.Scene();
  const bundle = buildMapLights({
    lights,
    scene,
    floors: [floorAt(0, 0), floorAt(1, 3, 'floor-1')],
    tileWorldSize: 1,
    heightUnit: 1,
    npcPositions: new Map(),
    ...overrides,
  });
  return { bundle, scene };
}

function firstLight(scene: THREE.Scene): THREE.Light {
  const group = scene.children.find((c) => c.name === 'map-lights');
  if (!group) throw new Error('expected map-lights group');
  const light = group.children.find((c) => (c as THREE.Light).isLight) as THREE.Light | undefined;
  if (!light) throw new Error('expected a light in the group');
  return light;
}

describe('LIGHT_BUDGET', () => {
  it('declares the WebGL2-floor maximums (8 point / 4 spot)', () => {
    expect(LIGHT_BUDGET).toEqual({ maxPoint: 8, maxSpot: 4 });
  });
});

describe('assertLightBudget / buildMapLights — budget', () => {
  it('throws loudly when point lights exceed the budget, naming counts', () => {
    const lights = Array.from({ length: 9 }, (_, i) => pointLight({ id: `p${i}`, x: i % 6, y: 0 }));
    expect(() => assertLightBudget(lights)).toThrow(/point 9\/8/);
    expect(() => build(lights)).toThrow(/spot 0\/4/);
  });

  it('builds when at the exact budget ceiling (8 point + 4 spot)', () => {
    const lights: LightDocument[] = [
      ...Array.from({ length: 8 }, (_, i) => pointLight({ id: `p${i}`, x: i % 6, y: 0 })),
      ...Array.from({ length: 4 }, (_, i) => spotLight({ id: `s${i}`, x: i, y: 1 })),
    ];
    const { bundle, scene } = build(lights);
    expect(bundle?.count).toBe(12);
    expect(scene.children.some((c) => c.name === 'map-lights')).toBe(true);
    bundle?.dispose();
  });
});

describe('buildMapLights — empty / contract', () => {
  it('returns undefined when lights is empty (no scene attachment)', () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;
    const bundle = buildMapLights({
      lights: [],
      scene,
      floors: [floorAt(0, 0)],
      tileWorldSize: 1,
      heightUnit: 1,
      npcPositions: new Map(),
    });
    expect(bundle).toBeUndefined();
    expect(scene.children.length).toBe(before);
  });
});

describe('buildMapLights — placement', () => {
  it('places a point light at tile center + ground Y + height offset', () => {
    // surface 2 + base 1 → world ground Y 3 at heightUnit 1; height 2 → light Y 5
    const floors = [floorAt(2, 1)];
    const { scene } = build([pointLight({ id: 'lamp', x: 3, y: 4, height: 2 })], {
      floors,
      tileWorldSize: 2,
      heightUnit: 1,
    });
    const light = firstLight(scene);
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.position.x).toBeCloseTo(tileCenterToWorld(3, 2));
    expect(light.position.z).toBeCloseTo(tileCenterToWorld(4, 2));
    expect(light.position.y).toBeCloseTo(5);
    expect(light.castShadow).toBe(false);
  });

  it('defaults placed height to 1 height unit when omitted', () => {
    const floors = [floorAt(0, 0)];
    const { scene } = build([pointLight({ id: 'default-h', x: 0, y: 0 })], {
      floors,
      heightUnit: 2,
    });
    const light = firstLight(scene);
    // groundY 0 + 1 * 2 = 2
    expect(light.position.y).toBeCloseTo(2);
  });

  it('spot light aims straight down with default cone ~π/6', () => {
    const { scene } = build([spotLight({ id: 'down', x: 2, y: 3, height: 1 })], {
      floors: [floorAt(0, 0)],
      tileWorldSize: 1,
      heightUnit: 1,
    });
    const light = firstLight(scene) as THREE.SpotLight;
    expect(light).toBeInstanceOf(THREE.SpotLight);
    expect(light.angle).toBeCloseTo(Math.PI / 6);
    expect(light.target.position.x).toBeCloseTo(light.position.x);
    expect(light.target.position.z).toBeCloseTo(light.position.z);
    expect(light.target.position.y).toBeCloseTo(light.position.y - 1);
    expect(light.castShadow).toBe(false);
  });
});

describe('buildMapLights — attached', () => {
  it('player light moves on updatePlayer with torch offset 0.5 * heightUnit', () => {
    const heightUnit = 2;
    const { bundle, scene } = build(
      [
        {
          id: 'torch',
          kind: 'point',
          color: '#ffffff',
          intensity: 1,
          range: 5,
          attach: 'player',
        },
      ],
      { heightUnit },
    );
    if (!bundle) throw new Error('expected lights bundle');
    const light = firstLight(scene);
    bundle.updatePlayer(new THREE.Vector3(10, 4, 12));
    expect(light.position.x).toBeCloseTo(10);
    expect(light.position.z).toBeCloseTo(12);
    expect(light.position.y).toBeCloseTo(4 + 0.5 * heightUnit);
  });

  it('npc light lands at npc position + attach offset', () => {
    const heightUnit = 1;
    const npcPositions = new Map<string, NpcLightAnchor>([
      ['guard', { x: 3, y: 4, floor: 0, groundY: 5 }],
    ]);
    const { scene } = build(
      [
        {
          id: 'lantern',
          kind: 'point',
          color: '#ffcc00',
          intensity: 1,
          range: 4,
          attach: 'guard',
        },
      ],
      { npcPositions, heightUnit, tileWorldSize: 1 },
    );
    const light = firstLight(scene);
    expect(light.position.x).toBeCloseTo(tileCenterToWorld(3, 1));
    expect(light.position.z).toBeCloseTo(tileCenterToWorld(4, 1));
    expect(light.position.y).toBeCloseTo(5 + 0.5 * heightUnit);
  });

  it('throws when attach names an npc missing from the runtime map', () => {
    expect(() =>
      build([
        {
          id: 'orphan',
          kind: 'point',
          color: '#ffffff',
          intensity: 1,
          range: 3,
          attach: 'ghost',
        },
      ]),
    ).toThrow(/unknown npc id "ghost"/);
  });
});

describe('buildMapLights — disposal', () => {
  it('removes the group, is idempotent, and records hop-stats lights count', () => {
    const scene = new THREE.Scene();
    const sentinel = new THREE.Object3D();
    scene.add(sentinel);
    const { bundle } = build(
      [pointLight({ id: 'a' }), pointLight({ id: 'b', x: 2, y: 2 })],
      {},
      {
        scene,
      },
    );
    if (!bundle) throw new Error('expected lights bundle');
    expect(bundle.count).toBe(2);
    expect(scene.children.length).toBe(2);

    bundle.dispose();
    expect(scene.children).toEqual([sentinel]);
    bundle.dispose();
    expect(scene.children).toEqual([sentinel]);

    const stats = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 0,
      outgoingFloorTextureKeys: 0,
      outgoingLights: bundle.count,
    });
    expect(stats.lastOutgoingLights).toBe(2);
  });
});
