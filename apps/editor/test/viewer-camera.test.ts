import { describe, expect, it } from 'vitest';
import { computeOverviewCameraDistance, computeOverviewCameraPose } from '../src/viewer-camera.js';

describe('computeOverviewCameraDistance', () => {
  it('scales with the larger map dimension', () => {
    expect(computeOverviewCameraDistance(100, 50, 0.9, 24)).toBeCloseTo(24); // capped
    expect(computeOverviewCameraDistance(10, 5, 0.9, 24)).toBeCloseTo(9);
  });

  it('caps at maxDistance for large maps', () => {
    expect(computeOverviewCameraDistance(512, 512, 0.9, 24)).toBe(24);
  });
});

describe('computeOverviewCameraPose', () => {
  it('looks straight at the map center', () => {
    const pose = computeOverviewCameraPose(10, 20, 40, 15);
    expect(pose.lookAt).toEqual({ x: 10, y: 0, z: 20 });
  });

  it('places the camera above and behind the center by distance', () => {
    const pose = computeOverviewCameraPose(0, 0, 40, 15);
    expect(pose.position.y).toBeGreaterThan(0);
    expect(pose.position.z).toBeGreaterThan(0);
    expect(pose.position.x).toBe(0);
  });

  it('clamps degenerate tilt angles into a well-conditioned range', () => {
    const pose = computeOverviewCameraPose(0, 0, 0, 15);
    expect(Number.isFinite(pose.position.y)).toBe(true);
    expect(Number.isFinite(pose.position.z)).toBe(true);
  });
});
