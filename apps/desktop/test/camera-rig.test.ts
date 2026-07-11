import { describe, expect, it } from 'vitest';
import {
  clampTiltDeg,
  computeCameraPose,
  cycleCameraMode,
  FIRST_PERSON_HEAD_HEIGHT_TILES,
  MAX_TILT_DEG,
  MIN_TILT_DEG,
  TOP_DOWN_TILT_DEG,
} from '../src/camera-rig.js';
import { clampRange } from '../src/clamp.js';

const BASE_PARAMS = { tiltDeg: 40, distance: 10, fovDeg: 45 };
const TARGET = { x: 3, y: 0, z: 5, facing: 'down' as const };

describe('computeCameraPose: hd2d mode', () => {
  it('places the camera above and behind the target at the configured tilt/distance, looking at the target', () => {
    const pose = computeCameraPose('hd2d', BASE_PARAMS, TARGET);

    const tiltRad = (BASE_PARAMS.tiltDeg * Math.PI) / 180;
    expect(pose.position.x).toBeCloseTo(TARGET.x);
    expect(pose.position.y).toBeCloseTo(TARGET.y + BASE_PARAMS.distance * Math.sin(tiltRad));
    expect(pose.position.z).toBeCloseTo(TARGET.z + BASE_PARAMS.distance * Math.cos(tiltRad));
    expect(pose.lookAt).toEqual({ x: TARGET.x, y: TARGET.y, z: TARGET.z });
    expect(pose.fovDeg).toBe(BASE_PARAMS.fovDeg);
  });

  it('keeps the character visible and focus on the character (not far-focused)', () => {
    const pose = computeCameraPose('hd2d', BASE_PARAMS, TARGET);
    expect(pose.hideCharacter).toBe(false);
    expect(pose.focusFar).toBe(false);
  });

  it('a steeper tilt raises the camera and pulls it closer in Z, for the same distance', () => {
    const shallow = computeCameraPose('hd2d', { ...BASE_PARAMS, tiltDeg: 20 }, TARGET);
    const steep = computeCameraPose('hd2d', { ...BASE_PARAMS, tiltDeg: 70 }, TARGET);
    expect(steep.position.y).toBeGreaterThan(shallow.position.y);
    expect(steep.position.z).toBeLessThan(shallow.position.z);
  });
});

describe('computeCameraPose: top-down mode', () => {
  it('ignores the params tilt and uses the fixed near-vertical top-down preset instead', () => {
    const pose = computeCameraPose('top-down', BASE_PARAMS, TARGET);

    const tiltRad = (TOP_DOWN_TILT_DEG * Math.PI) / 180;
    expect(pose.position.y).toBeCloseTo(TARGET.y + BASE_PARAMS.distance * Math.sin(tiltRad));
    expect(pose.position.z).toBeCloseTo(TARGET.z + BASE_PARAMS.distance * Math.cos(tiltRad));
  });

  it('keeps the character visible and focused (same as hd2d)', () => {
    const pose = computeCameraPose('top-down', BASE_PARAMS, TARGET);
    expect(pose.hideCharacter).toBe(false);
    expect(pose.focusFar).toBe(false);
  });
});

describe('computeCameraPose: first-person mode', () => {
  it('places the camera at head height above the target tile, hides the character', () => {
    const pose = computeCameraPose('first-person', BASE_PARAMS, TARGET);

    expect(pose.position).toEqual({
      x: TARGET.x,
      y: TARGET.y + FIRST_PERSON_HEAD_HEIGHT_TILES,
      z: TARGET.z,
    });
    expect(pose.hideCharacter).toBe(true);
    expect(pose.focusFar).toBe(true);
  });

  it.each([
    ['up', { x: 0, z: -1 }],
    ['down', { x: 0, z: 1 }],
    ['left', { x: -1, z: 0 }],
    ['right', { x: 1, z: 0 }],
  ] as const)('looks toward the facing direction "%s"', (facing, dir) => {
    const pose = computeCameraPose('first-person', BASE_PARAMS, { ...TARGET, facing });
    expect(Math.sign(pose.lookAt.x - pose.position.x)).toBe(Math.sign(dir.x));
    expect(Math.sign(pose.lookAt.z - pose.position.z)).toBe(Math.sign(dir.z));
    // Same height as the camera -- looking straight ahead, not up/down.
    expect(pose.lookAt.y).toBeCloseTo(pose.position.y);
  });
});

describe('clampTiltDeg', () => {
  it('clamps within [MIN_TILT_DEG, MAX_TILT_DEG]', () => {
    expect(clampTiltDeg(0)).toBe(MIN_TILT_DEG);
    expect(clampTiltDeg(1000)).toBe(MAX_TILT_DEG);
    expect(clampTiltDeg(40)).toBe(40);
  });

  it('treats NaN as the lower bound', () => {
    expect(clampTiltDeg(Number.NaN)).toBe(MIN_TILT_DEG);
  });
});

describe('clampRange', () => {
  it('clamps within the given [min, max]', () => {
    expect(clampRange(1, 3, 20)).toBe(3);
    expect(clampRange(100, 3, 20)).toBe(20);
    expect(clampRange(10, 3, 20)).toBe(10);
  });

  it('normalizes an inverted range instead of throwing', () => {
    expect(clampRange(5, 20, 3)).toBe(5);
    expect(clampRange(-5, 20, 3)).toBe(3);
  });
});

describe('cycleCameraMode', () => {
  it('cycles hd2d -> top-down -> first-person -> hd2d', () => {
    expect(cycleCameraMode('hd2d')).toBe('top-down');
    expect(cycleCameraMode('top-down')).toBe('first-person');
    expect(cycleCameraMode('first-person')).toBe('hd2d');
  });
});
