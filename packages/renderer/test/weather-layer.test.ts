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

  it('starts invisible (clear default)', () => {
    const { layer } = createInspect(8);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.particlesVisible).toBe(false);
  });
});

describe('setMode', () => {
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

  it('switching rain → snow updates uniforms (same mesh, single graph)', () => {
    const { layer } = createInspect(8);
    layer.setMode('rain');
    const mesh = layer.mesh;
    layer.setMode('snow');
    expect(layer.mesh).toBe(mesh);
    expect(layer.uniforms.fallSpeed.value).toBe(WEATHER_LOOK_PRESETS.snow.fallSpeed);
    expect(layer.uniforms.fallSpeed.value).not.toBe(WEATHER_LOOK_PRESETS.rain.fallSpeed);
  });
});

describe('followCamera', () => {
  it('writes the volume-center uniform from the camera position', () => {
    const { layer } = createInspect(4);
    layer.followCamera(new THREE.Vector3(3, 4, 5));
    expect(layer.uniforms.volumeCenter.value.x).toBe(3);
    expect(layer.uniforms.volumeCenter.value.y).toBe(4);
    expect(layer.uniforms.volumeCenter.value.z).toBe(5);
  });
});

describe('dispose', () => {
  it('removes the mesh from the scene and is idempotent', () => {
    const { scene, layer } = createInspect(4);
    expect(scene.children).toContain(layer.mesh);
    layer.dispose();
    expect(scene.children).not.toContain(layer.mesh);
    expect(() => layer.dispose()).not.toThrow();
    layer.dispose();
    expect(scene.children).not.toContain(layer.mesh);
  });
});
