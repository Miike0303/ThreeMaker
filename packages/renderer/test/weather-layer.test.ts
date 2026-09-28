/**
 * C8 WU-02: weather visual layer structure (mesh/count/visibility/uniforms).
 * Node-graph internals are live-smoke territory — these tests cover pure knobs
 * and object structure only (same precedent as hd2d-pipeline).
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  createWeatherLayer,
  WEATHER_LOOK_PRESETS,
  type WeatherLayer,
} from '../src/runtime/weather-layer.js';

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

/** Test surface: createWeatherLayer returns the public API plus inspectable handles. */
type WeatherLayerInspect = WeatherLayer & {
  readonly mesh: THREE.Sprite;
  readonly uniforms: {
    readonly fallSpeed: { value: number };
    readonly driftAmplitude: { value: number };
    readonly scale: { value: THREE.Vector2 };
    readonly tint: { value: THREE.Color };
    readonly opacity: { value: number };
    readonly volumeCenter: { value: THREE.Vector3 };
  };
};

function createInspect(particleCount?: number): {
  scene: THREE.Scene;
  layer: WeatherLayerInspect;
} {
  const scene = makeScene();
  const layer = createWeatherLayer({
    scene,
    ...(particleCount !== undefined ? { particleCount } : {}),
  }) as WeatherLayerInspect;
  return { scene, layer };
}

type GraphNodeShape = {
  readonly node?: unknown;
  readonly nodes?: unknown;
  readonly aNode?: unknown;
  readonly bNode?: unknown;
  readonly cNode?: unknown;
  readonly op?: string;
  readonly method?: string;
  readonly value?: unknown;
};

function graphContains(
  root: unknown,
  matches: (node: GraphNodeShape) => boolean,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (!root || typeof root !== 'object' || seen.has(root)) return false;
  seen.add(root);
  if (Array.isArray(root)) {
    return root.some((child) => graphContains(child, matches, seen));
  }
  const node = root as GraphNodeShape;
  if (matches(node)) return true;
  return [node.node, node.nodes, node.aNode, node.bNode, node.cNode].some((child) =>
    graphContains(child, matches, seen),
  );
}

function positionGraph(layer: WeatherLayerInspect): unknown {
  return (layer.mesh.material as THREE.SpriteNodeMaterial).positionNode;
}

function graphNode(root: unknown): GraphNodeShape {
  if (!root || typeof root !== 'object') throw new Error('Expected a shader node');
  const node = root as GraphNodeShape;
  return node.node === undefined ? node : graphNode(node.node);
}

function findGraphNode(root: unknown, matches: (node: GraphNodeShape) => boolean): GraphNodeShape {
  let found: GraphNodeShape | undefined;
  graphContains(root, (node) => {
    if (!matches(node)) return false;
    found = node;
    return true;
  });
  if (!found) throw new Error('Expected shader operation was not found');
  return found;
}

// Sample scalar shader arithmetic with explicit inputs, without creating a GPU device.
function evaluateScalarGraph(root: unknown, inputs: ReadonlyMap<GraphNodeShape, number>): number {
  const node = graphNode(root);
  const input = inputs.get(node);
  if (input !== undefined) return input;
  if (typeof node.value === 'number') return node.value;
  const a = evaluateScalarGraph(node.aNode, inputs);
  if (node.method === 'sin') return Math.sin(a);
  const b = evaluateScalarGraph(node.bNode, inputs);
  switch (node.op ?? node.method) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case 'max':
      return Math.max(a, b);
    default:
      throw new Error('Unsupported scalar shader operation');
  }
}

function particleOffsetGraph(layer: WeatherLayerInspect): GraphNodeShape {
  return graphNode(graphNode(positionGraph(layer)).bNode);
}

function localParticleAxes(layer: WeatherLayerInspect): readonly unknown[] {
  const local = graphNode(particleOffsetGraph(layer).aNode);
  if (!Array.isArray(local.nodes) || local.nodes.length !== 3) {
    throw new Error('Expected three local particle coordinates');
  }
  return local.nodes;
}

function sampleSpread(spread: unknown, fraction: number): number {
  const centered = graphNode(graphNode(spread).aNode);
  return evaluateScalarGraph(spread, new Map([[graphNode(centered.aNode), fraction]]));
}

describe('createWeatherLayer structure', () => {
  it('adds one mesh with instance count equal to particleCount (default 3000)', () => {
    const { scene, layer } = createInspect();
    expect(scene.children).toContain(layer.mesh);
    expect(layer.mesh.count).toBe(3000);
    expect(layer.particleCount).toBe(3000);
  });

  it('honors a custom particleCount', () => {
    const { layer } = createInspect(12);
    expect(layer.mesh.count).toBe(12);
    expect(layer.particleCount).toBe(12);
  });

  it('allows zero particles when weather visuals are disabled', () => {
    const { layer } = createInspect(0);
    expect(layer.mesh.count).toBe(0);
    expect(layer.particleCount).toBe(0);
    layer.dispose();
  });

  it('keeps the camera-centered particle volume visible to the renderer', () => {
    const { layer } = createInspect(8);
    expect(layer.mesh.frustumCulled).toBe(false);
    layer.dispose();
  });
  it('does not write depth for translucent particles', () => {
    const { layer } = createInspect(8);
    expect(layer.mesh.material.depthWrite).toBe(false);
    layer.dispose();
  });
  it('blends translucent rain and snow particles', () => {
    const { layer } = createInspect(8);
    expect(layer.mesh.material.transparent).toBe(true);
    layer.dispose();
  });
  it('sizes rain and snow particles in world space', () => {
    const { layer } = createInspect(8);
    expect((layer.mesh.material as THREE.SpriteNodeMaterial).sizeAttenuation).toBe(true);
    layer.dispose();
  });
  it('connects the scale uniform to particle size', () => {
    const { layer } = createInspect(8);
    expect((layer.mesh.material as THREE.SpriteNodeMaterial).scaleNode).toBe(layer.uniforms.scale);
    layer.dispose();
  });
  it('connects the opacity uniform to particle alpha', () => {
    const { layer } = createInspect(8);
    const colorNode = (layer.mesh.material as THREE.SpriteNodeMaterial).colorNode;
    expect((colorNode as unknown as { node: { nodes: unknown[] } }).node.nodes[1]).toBe(
      layer.uniforms.opacity,
    );
    layer.dispose();
  });
  it('mutation pin: connects the tint uniform to particle color', () => {
    const { layer } = createInspect(8);
    const colorNode = (layer.mesh.material as THREE.SpriteNodeMaterial).colorNode;
    expect((colorNode as unknown as { node: { nodes: unknown[] } }).node.nodes[0]).toBe(
      layer.uniforms.tint,
    );
    layer.dispose();
  });
  it('starts invisible (clear default)', () => {
    const { layer } = createInspect(8);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.particlesVisible).toBe(false);
  });
});

describe('particle position graph', () => {
  it('scales fall displacement by elapsed time and precipitation speed', () => {
    const { layer } = createInspect(4);
    const fall = findGraphNode(
      positionGraph(layer),
      (node) => node.bNode === layer.uniforms.fallSpeed,
    );
    const clock = graphNode(fall.aNode);

    for (const mode of ['rain', 'snow'] as const) {
      layer.setMode(mode);
      expect(evaluateScalarGraph(fall, new Map([[clock, 0]]))).toBe(0);
      expect(evaluateScalarGraph(fall, new Map([[clock, 0.5]]))).toBeCloseTo(
        layer.uniforms.fallSpeed.value / 2,
        10,
      );
    }
    layer.dispose();
  });

  it('oscillates lateral drift around zero at the active amplitude', () => {
    const { layer } = createInspect(4);
    const drift = graphNode(localParticleAxes(layer)[0]).bNode;
    const wave = findGraphNode(drift, (node) => node.method === 'sin');
    layer.setMode('snow');

    expect(evaluateScalarGraph(drift, new Map([[wave, 0]]))).toBe(0);
    expect(evaluateScalarGraph(drift, new Map([[wave, 1]]))).toBe(
      layer.uniforms.driftAmplitude.value,
    );
    expect(evaluateScalarGraph(drift, new Map([[wave, -1]]))).toBe(
      -layer.uniforms.driftAmplitude.value,
    );
    layer.dispose();
  });

  it('spreads particle drift phases over a full sine cycle', () => {
    const { layer } = createInspect(4);
    const wave = findGraphNode(positionGraph(layer), (node) => node.method === 'sin');
    const angle = graphNode(wave.aNode);
    const clock = graphNode(graphNode(angle.aNode).aNode);
    const phaseSample = graphNode(graphNode(angle.bNode).aNode);
    const sampleAt = (fraction: number): number =>
      evaluateScalarGraph(
        wave,
        new Map([
          [clock, 0],
          [phaseSample, fraction],
        ]),
      );

    expect(sampleAt(0.25)).toBeCloseTo(1, 8);
    expect(sampleAt(0.75)).toBeCloseTo(-1, 8);
    layer.dispose();
  });

  it('spans thirty world units horizontally before lateral drift', () => {
    const { layer } = createInspect(4);
    const spread = graphNode(localParticleAxes(layer)[0]).aNode;
    expect(sampleSpread(spread, 0.75) - sampleSpread(spread, 0.25)).toBe(15);
    layer.dispose();
  });

  it('spans thirty world units in depth', () => {
    const { layer } = createInspect(4);
    const spread = localParticleAxes(layer)[2];
    expect(sampleSpread(spread, 0.75) - sampleSpread(spread, 0.25)).toBe(15);
    layer.dispose();
  });

  it('centers horizontal samples on the camera before lateral drift', () => {
    const { layer } = createInspect(4);
    const spread = graphNode(localParticleAxes(layer)[0]).aNode;
    expect(sampleSpread(spread, 0.5)).toBe(0);
    layer.dispose();
  });

  it('centers wrapped vertical samples on the camera', () => {
    const { layer } = createInspect(4);
    expect(sampleSpread(localParticleAxes(layer)[1], 0.5)).toBe(0);
    layer.dispose();
  });

  it('centers depth samples on the camera', () => {
    const { layer } = createInspect(4);
    expect(sampleSpread(localParticleAxes(layer)[2], 0.5)).toBe(0);
    layer.dispose();
  });

  it('leaves particles outside the keepout radius at their sampled distance', () => {
    const { layer } = createInspect(4);
    const scale = particleOffsetGraph(layer).bNode;
    const length = findGraphNode(scale, (node) => node.method === 'length');
    expect(evaluateScalarGraph(scale, new Map([[length, 10]])) * 10).toBe(10);
    layer.dispose();
  });

  it('keeps the particle scale finite at zero camera distance', () => {
    const { layer } = createInspect(4);
    const scale = particleOffsetGraph(layer).bNode;
    const length = findGraphNode(scale, (node) => node.method === 'length');
    expect(Number.isFinite(evaluateScalarGraph(scale, new Map([[length, 0]])))).toBe(true);
    layer.dispose();
  });

  it('completes lateral drift at the configured slow angular speed', () => {
    const { layer } = createInspect(4);
    const wave = findGraphNode(positionGraph(layer), (node) => node.method === 'sin');
    const angle = graphNode(wave.aNode);
    const clock = graphNode(graphNode(angle.aNode).aNode);
    const phase = graphNode(angle.bNode);
    const sampleAt = (seconds: number): number =>
      evaluateScalarGraph(
        wave,
        new Map([
          [clock, seconds],
          [phase, 0],
        ]),
      );
    const period = (2 * Math.PI) / 0.7;
    expect(sampleAt(period / 4)).toBeCloseTo(1, 8);
    expect(sampleAt(period / 2)).toBeCloseTo(0, 8);
    expect(sampleAt(period)).toBeCloseTo(0, 8);
    layer.dispose();
  });

  it('adds the camera center to each particle offset', () => {
    const { layer } = createInspect(4);
    const root = positionGraph(layer) as { node?: { op?: string; aNode?: unknown } };
    expect(root.node?.op).toBe('+');
    expect(root.node?.aNode).toBe(layer.uniforms.volumeCenter);
    layer.dispose();
  });

  it('uses the fall-speed uniform to animate vertical movement', () => {
    const { layer } = createInspect(4);
    expect(graphContains(positionGraph(layer), (node) => node === layer.uniforms.fallSpeed)).toBe(
      true,
    );
    layer.dispose();
  });

  it('uses the drift-amplitude uniform to animate lateral movement', () => {
    const { layer } = createInspect(4);
    expect(
      graphContains(positionGraph(layer), (node) => node === layer.uniforms.driftAmplitude),
    ).toBe(true);
    layer.dispose();
  });

  it('moves falling particles downward as time advances', () => {
    const { layer } = createInspect(4);
    expect(
      graphContains(
        positionGraph(layer),
        (node) =>
          node.op === '-' &&
          graphContains(node.bNode, (operand) => operand === layer.uniforms.fallSpeed),
      ),
    ).toBe(true);
    layer.dispose();
  });

  it('keeps particles at least two world units from the camera', () => {
    const { layer } = createInspect(4);
    expect(
      graphContains(
        positionGraph(layer),
        (node) => node.op === '/' && graphContains(node.aNode, (operand) => operand.value === 2),
      ),
    ).toBe(true);
    layer.dispose();
  });

  it('spans a twenty-unit vertical weather volume', () => {
    const { layer } = createInspect(4);
    expect(
      graphContains(
        positionGraph(layer),
        (node) => node.op === '*' && graphContains(node.bNode, (operand) => operand.value === 20),
      ),
    ).toBe(true);
    layer.dispose();
  });

  it('wraps falling particles after one vertical volume', () => {
    const { layer } = createInspect(4);
    expect(
      graphContains(
        positionGraph(layer),
        (node) => node.op === '%' && graphContains(node.bNode, (operand) => operand.value === 1),
      ),
    ).toBe(true);
    layer.dispose();
  });
});

describe('setMode', () => {
  it('renders snowflakes more opaque than rain streaks', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const rainOpacity = layer.uniforms.opacity.value;
    layer.setMode('snow');

    expect(layer.uniforms.opacity.value).toBeGreaterThan(rainOpacity);
    layer.dispose();
  });

  it('shows the mesh for rain and hides it for clear', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    expect(layer.mesh.visible).toBe(true);
    expect(layer.particlesVisible).toBe(true);

    layer.setMode('clear');
    expect(layer.mesh.visible).toBe(false);
    expect(layer.particlesVisible).toBe(false);
  });

  it('shows the mesh for snow and hides it for fog', () => {
    const { layer } = createInspect(8);
    layer.setMode('snow');
    expect(layer.mesh.visible).toBe(true);

    layer.setMode('fog');
    expect(layer.mesh.visible).toBe(false);
  });

  it('applies rain look preset uniforms without rebuilding the graph', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const rain = WEATHER_LOOK_PRESETS.rain;
    expect(layer.uniforms.fallSpeed.value).toBe(rain.fallSpeed);
    expect(layer.uniforms.driftAmplitude.value).toBe(rain.driftAmplitude);
    expect(layer.uniforms.scale.value.x).toBe(rain.scaleX);
    expect(layer.uniforms.scale.value.y).toBe(rain.scaleY);
    expect(layer.uniforms.opacity.value).toBe(rain.opacity);
    expect(layer.uniforms.tint.value.getHex()).toBe(rain.tint);
  });

  it('makes rain fall substantially faster than snow', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const rainSpeed = layer.uniforms.fallSpeed.value;
    layer.setMode('snow');
    expect(rainSpeed).toBeGreaterThan(layer.uniforms.fallSpeed.value * 4);
    layer.dispose();
  });

  it('tints rain blue instead of neutral white', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    expect(layer.uniforms.tint.value.b).toBeGreaterThan(layer.uniforms.tint.value.r);
    layer.dispose();
  });

  it('keeps rain translucent', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    expect(layer.uniforms.opacity.value).toBeLessThan(1);
    layer.dispose();
  });

  it('keeps rain streaks shorter than five snowflake widths', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const streakLength = layer.uniforms.scale.value.y;
    layer.setMode('snow');
    expect(streakLength).toBeLessThan(layer.uniforms.scale.value.x * 5);
    layer.dispose();
  });

  it('mutation pin: renders rain as narrow vertical streaks', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    expect(layer.uniforms.scale.value.y).toBeGreaterThan(layer.uniforms.scale.value.x * 10);
    layer.dispose();
  });

  it('mutation pin: keeps rain drift much smaller than snow drift', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const rainDrift = layer.uniforms.driftAmplitude.value;
    layer.setMode('snow');
    expect(rainDrift).toBeLessThan(layer.uniforms.driftAmplitude.value * 0.1);
    layer.dispose();
  });

  it('applies snow look preset uniforms', () => {
    const { layer } = createInspect(8);
    layer.setMode('snow');
    const snow = WEATHER_LOOK_PRESETS.snow;
    expect(layer.uniforms.fallSpeed.value).toBe(snow.fallSpeed);
    expect(layer.uniforms.driftAmplitude.value).toBe(snow.driftAmplitude);
    expect(layer.uniforms.scale.value.x).toBe(snow.scaleX);
    expect(layer.uniforms.scale.value.y).toBe(snow.scaleY);
    expect(layer.uniforms.opacity.value).toBe(snow.opacity);
    expect(layer.uniforms.tint.value.getHex()).toBe(snow.tint);
  });

  it('renders snowflakes pure white', () => {
    const { layer } = createInspect(8);
    layer.setMode('snow');
    expect(layer.uniforms.tint.value.getHex()).toBe(0xffffff);
    layer.dispose();
  });

  it('mutation pin: renders snow as square flakes', () => {
    const { layer } = createInspect(8);
    layer.setMode('snow');
    expect(layer.uniforms.scale.value.x).toBe(layer.uniforms.scale.value.y);
    layer.dispose();
  });

  it('mutation pin: keeps snowflakes translucent', () => {
    const { layer } = createInspect(8);
    layer.setMode('snow');
    expect(layer.uniforms.opacity.value).toBeLessThan(1);
    layer.dispose();
  });

  it('switching rain → snow updates uniforms (same mesh, single graph)', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const mesh = layer.mesh;
    layer.setMode('snow');
    expect(layer.mesh).toBe(mesh);
    expect(layer.uniforms.fallSpeed.value).toBe(WEATHER_LOOK_PRESETS.snow.fallSpeed);
    expect(layer.uniforms.fallSpeed.value).not.toBe(WEATHER_LOOK_PRESETS.rain.fallSpeed);
  });

  it('ignores mode changes after disposal', () => {
    const { layer } = createInspect(8);
    layer.dispose();
    layer.setMode('rain');
    expect(layer.particlesVisible).toBe(false);
  });
});

describe('followCamera', () => {
  it('replaces the previous camera center on each follow update', () => {
    const { layer } = createInspect(4);
    layer.followCamera(new THREE.Vector3(3, 4, 5));
    layer.followCamera(new THREE.Vector3(-2, 8, 1));

    expect(layer.uniforms.volumeCenter.value.toArray()).toEqual([-2, 8, 1]);
    layer.dispose();
  });

  it('writes the volume-center uniform from the camera position', () => {
    const { layer } = createInspect(4);
    layer.followCamera(new THREE.Vector3(3, 4, 5));
    expect(layer.uniforms.volumeCenter.value.x).toBe(3);
    expect(layer.uniforms.volumeCenter.value.y).toBe(4);
    expect(layer.uniforms.volumeCenter.value.z).toBe(5);
  });

  it('stops following the camera after disposal', () => {
    const { layer } = createInspect(4);
    layer.followCamera(new THREE.Vector3(3, 4, 5));
    layer.dispose();
    layer.followCamera(new THREE.Vector3(8, 9, 10));
    expect(layer.uniforms.volumeCenter.value.toArray()).toEqual([3, 4, 5]);
  });
});

describe('dispose', () => {
  it('releases the particle material only once across repeated disposal', () => {
    const { layer } = createInspect(4);
    let disposeCalls = 0;
    layer.mesh.material.addEventListener('dispose', () => {
      disposeCalls++;
    });

    layer.dispose();
    layer.dispose();

    expect(disposeCalls).toBe(1);
  });

  it('removes the mesh from the scene and is idempotent', () => {
    const { scene, layer } = createInspect(4);
    expect(scene.children).toContain(layer.mesh);
    layer.dispose();
    expect(scene.children).not.toContain(layer.mesh);
    expect(() => layer.dispose()).not.toThrow();
    layer.dispose();
    expect(scene.children).not.toContain(layer.mesh);
  });

  it('releases the particle material', () => {
    const { layer } = createInspect(4);
    let disposeCalls = 0;
    layer.mesh.material.addEventListener('dispose', () => {
      disposeCalls++;
    });
    layer.dispose();
    expect(disposeCalls).toBe(1);
  });
});
