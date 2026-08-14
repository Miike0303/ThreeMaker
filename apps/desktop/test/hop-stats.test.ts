import { ElevationField } from '@threemaker/gameplay';
import type { LightDocument, PropDocument } from '@threemaker/map-format';
import { buildMapLights, buildMapProps, type ParseGltfResult } from '@threemaker/renderer';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createHopStats, recordHopCompleted } from '../src/hop-stats.js';
import { buildMap } from './fixtures.js';

const PROP_SHA_A = 'a'.repeat(64);
const PROP_SHA_B = 'b'.repeat(64);

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

function prop(overrides: Partial<PropDocument> & Pick<PropDocument, 'id'>): PropDocument {
  return {
    x: 1,
    y: 2,
    floor: 'floor-0',
    object: PROP_SHA_A,
    ...overrides,
  };
}

/** Canned static mesh graph (no skin, no lights). */
function cannedMeshScene(name = 'PropMesh'): ParseGltfResult {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  const scene = new THREE.Group();
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('spin', 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0]),
      ]),
      new THREE.AnimationClip('idle', 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      ]),
    ],
  };
}

describe('hop-stats', () => {
  it('starts at zero hops and zero last-outgoing counts', () => {
    expect(createHopStats()).toEqual({
      hopsCompleted: 0,
      lastOutgoingNarrativeSprites: 0,
      lastOutgoingFloorTextureKeys: 0,
      lastOutgoingPropInstances: 0,
      lastOutgoingPropAssets: 0,
      lastOutgoingLights: 0,
    });
  });

  it('records each completed hop and the outgoing resource counts at dispose time', () => {
    const a = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 2,
      outgoingFloorTextureKeys: 4,
      outgoingPropInstances: 3,
      outgoingPropAssets: 1,
      outgoingLights: 5,
    });
    expect(a).toEqual({
      hopsCompleted: 1,
      lastOutgoingNarrativeSprites: 2,
      lastOutgoingFloorTextureKeys: 4,
      lastOutgoingPropInstances: 3,
      lastOutgoingPropAssets: 1,
      lastOutgoingLights: 5,
    });

    const b = recordHopCompleted(a, {
      outgoingNarrativeSprites: 1,
      outgoingFloorTextureKeys: 3,
    });
    expect(b.hopsCompleted).toBe(2);
    expect(b.lastOutgoingNarrativeSprites).toBe(1);
    expect(b.lastOutgoingFloorTextureKeys).toBe(3);
    // Omitted prop/light counters default to 0 (maps without props/lights).
    expect(b.lastOutgoingPropInstances).toBe(0);
    expect(b.lastOutgoingPropAssets).toBe(0);
    expect(b.lastOutgoingLights).toBe(0);

    const scene = new THREE.Scene();
    const lightsBundle = buildMapLights({
      lights: [pointLight({ id: 'a' }), pointLight({ id: 'b', x: 2, y: 2 })],
      scene,
      floors: [floorAt(0, 0), floorAt(1, 3, 'floor-1')],
      tileWorldSize: 1,
      heightUnit: 1,
      npcPositions: new Map(),
    });
    if (!lightsBundle) throw new Error('expected lights bundle');
    expect(lightsBundle.count).toBe(2);

    const lightStats = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 0,
      outgoingFloorTextureKeys: 0,
      outgoingLights: lightsBundle.count,
    });
    expect(lightStats.lastOutgoingLights).toBe(2);
    lightsBundle.dispose();
  });

  it('records hop-stats prop instance and asset counts on hop dispose', async () => {
    const parseGltf = vi.fn(async (bytes: Uint8Array) => {
      // Distinct canned scene per call so asset count tracks parse calls.
      void bytes;
      return cannedMeshScene();
    });
    // Force two assets by two shas; three instances.
    const bundle = await buildMapProps({
      props: [
        prop({ id: 'a', object: PROP_SHA_A }),
        prop({ id: 'b', object: PROP_SHA_A }),
        prop({ id: 'c', object: PROP_SHA_B }),
      ],
      scene: new THREE.Scene(),
      floors: [floorAt(0, 0), floorAt(1, 3, 'floor-1')],
      tileWorldSize: 1,
      heightUnit: 1,
      parseGltf: vi.fn(async () => cannedMeshScene()),
      resolveObjectBinary: vi.fn(async () => new Uint8Array([1])),
    });
    if (!bundle) throw new Error('expected props bundle');
    expect(bundle.count).toBe(3);
    expect(bundle.assetCount).toBe(2);

    const stats = recordHopCompleted(createHopStats(), {
      outgoingNarrativeSprites: 0,
      outgoingFloorTextureKeys: 0,
      outgoingPropInstances: bundle.count,
      outgoingPropAssets: bundle.assetCount,
    });
    expect(stats.lastOutgoingPropInstances).toBe(3);
    expect(stats.lastOutgoingPropAssets).toBe(2);
    void parseGltf;
    bundle.dispose();
  });
});
