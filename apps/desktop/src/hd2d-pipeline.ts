import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import {
  add,
  color,
  emissive,
  float,
  fog,
  mrt,
  output,
  pass,
  rangeFogFactor,
  uniform,
  vec4,
} from 'three/tsl';
import type * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { RenderPipeline } from 'three/webgpu';
import type { Hd2dKnobsOverride } from './hd2d-knobs.js';
import { clampFocusDistance, resolveKnobs } from './hd2d-knobs.js';

// The `add` and `vec4` TSL operators in @types/three@0.185.1 carry overload
// sets so large that resolving a call against them under this tsconfig makes
// tsc run away (>20GB RAM, never finishes). These narrowed aliases call the
// exact same runtime functions but sever that overload resolution.
const addVec4 = add as unknown as (a: Node<'vec4'>, b: Node<'vec4'>) => Node<'vec4'>;
const vec4FromVec3 = vec4 as unknown as (rgb: Node<'vec3'>, alpha: number) => Node<'vec4'>;

export interface Hd2dPipeline {
  readonly pipeline: THREE.RenderPipeline;
  /** Renders through the post-processing chain; while disabled, renders the scene directly (bloom/DoF/vignette off — fog is scene-level and stays active either way). */
  render(): void;
  /** Toggles bloom/DoF/vignette on/off. Fog is applied via `scene.fogNode` at the material level, so it is NOT affected by this toggle. */
  setEnabled(on: boolean): void;
  /** Clamps `distance` to the configured DoF range and writes it to the focus uniform. */
  setFocusDistance(distance: number): void;
  /** Disposes the pipeline's GPU resources and clears `scene.fogNode`. */
  dispose(): void;
}

/**
 * Builds the HD-2D post-processing chain: selective bloom (from the MRT
 * emissive channel) -> scene fog -> tilt-shift depth of field -> vignette.
 * Fog is applied via `scene.fogNode` (not the post-chain output) since that
 * is the composable path that actually uses the render's own viewZ.
 */
export function createHd2dPipeline(
  renderer: THREE.Renderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  knobs?: Hd2dKnobsOverride,
): Hd2dPipeline {
  const resolved = resolveKnobs(knobs);

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive }));

  const sceneColor: Node<'vec4'> = scenePass.getTextureNode('output');
  const sceneEmissive: Node<'vec4'> = scenePass.getTextureNode('emissive');
  const viewZ = scenePass.getViewZNode();

  const bloomPass = bloom(
    sceneEmissive,
    resolved.bloom.strength,
    resolved.bloom.radius,
    resolved.bloom.threshold,
  );
  const withBloom = addVec4(sceneColor, bloomPass);

  scene.fogNode = fog(
    color(resolved.fog.color),
    rangeFogFactor(resolved.fog.near, resolved.fog.far),
  );

  const focusDistanceUniform = uniform(resolved.dof.focusDistanceMin);
  const dofPass = dof(
    withBloom,
    viewZ,
    focusDistanceUniform,
    resolved.dof.focalLength,
    resolved.dof.bokehScale,
  );

  // vignette() operates on vec3 color; re-attach alpha afterward so the
  // pipeline's final outputNode stays a vec4. The `.rgb` swizzle exists at
  // runtime via TSL method chaining but not on DepthOfFieldNode's type.
  const dofRgb = dofPass as unknown as { rgb: Node<'vec3'> };
  const vignettePass = vec4FromVec3(
    vignette(dofRgb.rgb, float(resolved.vignette.intensity), float(resolved.vignette.smoothness)),
    1,
  );

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = vignettePass;

  let enabled = true;

  return {
    pipeline,
    render() {
      if (enabled) pipeline.render();
      else renderer.render(scene, camera);
    },
    setEnabled(on: boolean) {
      enabled = on;
    },
    setFocusDistance(distance: number) {
      focusDistanceUniform.value = clampFocusDistance(
        distance,
        resolved.dof.focusDistanceMin,
        resolved.dof.focusDistanceMax,
      );
    },
    dispose() {
      pipeline.dispose();
      scenePass.dispose();
      bloomPass.dispose();
      dofPass.dispose();
      scene.fogNode = null;
    },
  };
}
