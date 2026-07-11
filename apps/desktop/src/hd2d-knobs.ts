import { clampRange } from './clamp.js';

/** Tuning knobs for the HD-2D post-processing chain (see `hd2d-pipeline.ts`). */
export interface Hd2dKnobs {
  readonly bloom: {
    readonly strength: number;
    readonly radius: number;
    readonly threshold: number;
  };
  readonly fog: {
    readonly color: number;
    readonly near: number;
    readonly far: number;
  };
  readonly dof: {
    readonly focalLength: number;
    readonly bokehScale: number;
    readonly focusDistanceMin: number;
    readonly focusDistanceMax: number;
  };
  readonly vignette: {
    readonly intensity: number;
    readonly smoothness: number;
  };
}

/** Deep-partial override of `Hd2dKnobs`, one entry per group. */
export type Hd2dKnobsOverride = {
  readonly [K in keyof Hd2dKnobs]?: Partial<Hd2dKnobs[K]>;
};

/**
 * Default art-calibration values. These are a first pass, not final art
 * direction -- expect re-tuning once the pipeline is visible in-engine.
 * Bloom and vignette are deliberately subtle (this map has few emissives),
 * and DoF's bokehScale is kept small so pixel-art edges near the focal
 * plane stay crisp (tilt-shift diorama fake, not photographic bokeh).
 */
export const DEFAULT_HD2D_KNOBS: Hd2dKnobs = {
  bloom: {
    strength: 0.3,
    radius: 0.2,
    threshold: 0.85,
  },
  fog: {
    color: 0x1a1a2e,
    near: 15,
    far: 60,
  },
  dof: {
    focalLength: 3,
    bokehScale: 0.15,
    focusDistanceMin: 1,
    focusDistanceMax: 100,
  },
  vignette: {
    intensity: 0.25,
    smoothness: 0.5,
  },
};

/** Merges a partial override on top of `DEFAULT_HD2D_KNOBS`, group by group. */
export function resolveKnobs(override?: Hd2dKnobsOverride): Hd2dKnobs {
  return {
    bloom: { ...DEFAULT_HD2D_KNOBS.bloom, ...override?.bloom },
    fog: { ...DEFAULT_HD2D_KNOBS.fog, ...override?.fog },
    dof: { ...DEFAULT_HD2D_KNOBS.dof, ...override?.dof },
    vignette: { ...DEFAULT_HD2D_KNOBS.vignette, ...override?.vignette },
  };
}

/**
 * Clamps `distance` into `[min, max]` (see `clampRange` for the defensive
 * contract) so a bad camera-distance read never propagates into the DoF
 * uniform.
 */
export function clampFocusDistance(distance: number, min: number, max: number): number {
  return clampRange(distance, min, max);
}
