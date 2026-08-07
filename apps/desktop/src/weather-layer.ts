/**
 * C8 WU-02: session-scoped weather particle layer (instanced GPU rain/snow).
 *
 * Single-graph strategy: ONE Sprite + SpriteNodeMaterial built once. Rain vs
 * snow look differences are driven only through uniforms (fall speed, drift,
 * scale, tint, opacity). clear/fog hide the mesh (`visible = false`) — no
 * material/graph rebuild on mode switch (avoids shader recompile stutter).
 *
 * WebGPU note: THREE.Points is 1px max under WebGPU (sizeNode ignored). We use
 * instanced billboard quads via Sprite.count + SpriteNodeMaterial.positionNode.
 */

import { float, hash, instanceIndex, mod, sin, time, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import * as THREE from 'three/webgpu';
import type { WeatherMode } from './session-weather.js';

// @types/three TSL overloads explode tsc memory on method chains (.add/.mul/…).
// Build the graph through a loosely-typed surface; runtime nodes are identical.
// Same class of trap as hd2d-pipeline.ts:23-28.
type Tsl = {
  add(a: unknown): Tsl;
  sub(a: unknown): Tsl;
  mul(a: unknown): Tsl;
  div(a: unknown): Tsl;
  max(a: unknown): Tsl;
  toFloat(): Tsl;
  length(): Tsl;
};
const tsl = (n: unknown): Tsl => n as Tsl;
const asNode = <T extends string = 'float'>(n: unknown): Node<T> => n as Node<T>;

// Narrowed constructors (same trap as `add`/`vec4` in hd2d-pipeline).
const vec3Of = vec3 as unknown as (x: unknown, y: unknown, z: unknown) => Node<'vec3'>;
const vec4Of = vec4 as unknown as (rgb: unknown, alpha: unknown) => Node<'vec4'>;
const hashOf = hash as unknown as (seed: unknown) => Node<'float'>;
const modOf = mod as unknown as (a: unknown, b: unknown) => Node<'float'>;
const sinOf = sin as unknown as (a: unknown) => Node<'float'>;
const floatOf = float as unknown as (a: unknown) => Node<'float'>;

/** World-space particle volume (box centered on the camera). */
const VOLUME_WIDTH = 30;
const VOLUME_HEIGHT = 20;
const VOLUME_DEPTH = 30;
/**
 * DoF blurs near geometry: keep particle content from hugging the near plane.
 * After hashing into the volume box we push any sample inside this radius
 * outward so quads start ~2 world units from the camera.
 */
const NEAR_KEEPOUT = 2;

const DEFAULT_PARTICLE_COUNT = 3000;

/** Uniform-driven look presets for the single particle graph. */
export const WEATHER_LOOK_PRESETS = {
  rain: {
    fallSpeed: 8,
    driftAmplitude: 0.05,
    scaleX: 0.02,
    scaleY: 0.25,
    /** Slight blue-white. */
    tint: 0xb8c8e0,
    opacity: 0.5,
  },
  snow: {
    fallSpeed: 1.2,
    driftAmplitude: 0.85,
    scaleX: 0.06,
    scaleY: 0.06,
    tint: 0xffffff,
    opacity: 0.8,
  },
} as const;

export interface WeatherLayerDeps {
  readonly scene: {
    add(...objects: THREE.Object3D[]): void;
    remove(...objects: THREE.Object3D[]): void;
  };
  readonly particleCount?: number;
}

export interface WeatherLayer {
  setMode(mode: WeatherMode): void;
  followCamera(position: THREE.Vector3): void;
  dispose(): void;
  /** True when rain/snow particles are drawn. */
  readonly particlesVisible: boolean;
  readonly particleCount: number;
}

/**
 * Builds the session-scoped weather particle layer (once per play session).
 * Hop teardown must not touch this — it outlives map swaps.
 */
export function createWeatherLayer(deps: WeatherLayerDeps): WeatherLayer {
  const particleCount = deps.particleCount ?? DEFAULT_PARTICLE_COUNT;

  const fallSpeedU = uniform(0);
  const driftAmplitudeU = uniform(0);
  const scaleU = uniform(new THREE.Vector2(0.02, 0.25));
  const tintU = uniform(new THREE.Color(0xb8c8e0));
  const opacityU = uniform(0.5);
  const volumeCenterU = uniform(new THREE.Vector3());

  // Per-instance base in [0,1)^3 from instanceIndex via hash; fall + wrap in
  // the volume box; optional lateral drift. 100% GPU — no per-frame JS attrs.
  const seed = tsl(instanceIndex).toFloat().add(1);
  const hx = tsl(hashOf(seed));
  const hy = tsl(hashOf(tsl(seed).add(17)));
  const hz = tsl(hashOf(tsl(seed).add(31)));
  const hPhase = tsl(hashOf(tsl(seed).add(47)));

  const fall = tsl(time).mul(fallSpeedU);
  const y01 = tsl(modOf(hy.sub(fall), floatOf(1)));
  const drift = tsl(sinOf(tsl(time).mul(0.7).add(hPhase.mul(6.2831853)))).mul(driftAmplitudeU);

  const lx = hx.sub(0.5).mul(VOLUME_WIDTH).add(drift);
  const ly = y01.sub(0.5).mul(VOLUME_HEIGHT);
  const lz = hz.sub(0.5).mul(VOLUME_DEPTH);
  const local = tsl(vec3Of(lx, ly, lz));

  // NEAR_KEEPOUT (2): push samples inside the keepout sphere outward.
  const len = local.length().max(0.0001);
  const pushScale = tsl(floatOf(NEAR_KEEPOUT)).div(len).max(1);
  const positionNode = asNode<'vec3'>(tsl(volumeCenterU).add(local.mul(pushScale)));

  const material = new THREE.SpriteNodeMaterial();
  // Translucent weather layer: no depth write so DoF/opaque geometry is not
  // occluded by particle quads (avoids dark “holes” and occlusion artifacts).
  material.depthWrite = false;
  material.transparent = true;
  // MRT emissive deliberately unset (contributes 0) so rain/snow never blooms.
  material.positionNode = positionNode;
  material.scaleNode = scaleU;
  material.colorNode = vec4Of(tintU, opacityU);
  // sizeAttenuation: world-sized streaks/flakes (not screen-pixel locked).
  material.sizeAttenuation = true;

  const mesh = new THREE.Sprite(material);
  mesh.count = particleCount;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.name = 'weather-particles';
  deps.scene.add(mesh);

  let disposed = false;

  function applyLook(
    preset: (typeof WEATHER_LOOK_PRESETS)[keyof typeof WEATHER_LOOK_PRESETS],
  ): void {
    fallSpeedU.value = preset.fallSpeed;
    driftAmplitudeU.value = preset.driftAmplitude;
    scaleU.value.set(preset.scaleX, preset.scaleY);
    tintU.value.setHex(preset.tint);
    opacityU.value = preset.opacity;
  }

  const layer = {
    setMode(mode: WeatherMode): void {
      if (disposed) return;
      if (mode === 'rain') {
        applyLook(WEATHER_LOOK_PRESETS.rain);
        mesh.visible = true;
        return;
      }
      if (mode === 'snow') {
        applyLook(WEATHER_LOOK_PRESETS.snow);
        mesh.visible = true;
        return;
      }
      // clear / fog: particles off (fog densifies scene fogNode only).
      mesh.visible = false;
    },

    followCamera(position: THREE.Vector3): void {
      if (disposed) return;
      volumeCenterU.value.copy(position);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      deps.scene.remove(mesh);
      material.dispose();
      // Sprite shares a module-level geometry — do not dispose it.
    },

    get particlesVisible(): boolean {
      return mesh.visible;
    },

    get particleCount(): number {
      return particleCount;
    },

    // Inspectable handles for unit tests (not part of the minimal public API).
    mesh,
    uniforms: {
      fallSpeed: fallSpeedU,
      driftAmplitude: driftAmplitudeU,
      scale: scaleU,
      tint: tintU,
      opacity: opacityU,
      volumeCenter: volumeCenterU,
    },
  };

  return layer;
}
