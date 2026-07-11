import { describe, expect, it } from 'vitest';
import {
  computeOverviewCameraDistance,
  computeOverviewCameraPose,
  projectToScreenFraction,
} from '../src/viewer-camera.js';

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

describe('projectToScreenFraction', () => {
  const pose = { position: { x: 0, y: 10, z: 10 }, lookAt: { x: 0, y: 0, z: 0 } };

  it('projects the look-at target to the exact screen center', () => {
    const result = projectToScreenFraction({ x: 0, y: 0, z: 0 }, pose, 45, 1);
    expect(result?.xFrac).toBeCloseTo(0.5);
    expect(result?.yFrac).toBeCloseTo(0.5);
  });

  it('projects a point offset toward +x to the right half of the screen', () => {
    const result = projectToScreenFraction({ x: 5, y: 0, z: 0 }, pose, 45, 1);
    expect(result?.xFrac).toBeGreaterThan(0.5);
  });

  it('returns undefined for a point behind the camera', () => {
    // Along the camera's own viewing ray, past its position, away from lookAt.
    const behind = { x: 0, y: 13.5355, z: 13.5355 };
    expect(projectToScreenFraction(behind, pose, 45, 1)).toBeUndefined();
  });
});
