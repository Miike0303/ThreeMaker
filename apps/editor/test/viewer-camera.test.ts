import { describe, expect, it } from 'vitest';
import {
  computeOverviewCameraDistance,
  computeOverviewCameraPose,
  panCameraTarget,
  projectToScreenFraction,
  zoomCameraDistance,
  zoomCameraDistanceByFactor,
  zoomPercentForDistance,
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

describe('zoomCameraDistance (WU-UX-01)', () => {
  const bounds = { min: 5, max: 40 };

  it('zooms out (larger distance) on a positive wheel delta and in on a negative one', () => {
    expect(zoomCameraDistance(20, 120, bounds)).toBeGreaterThan(20);
    expect(zoomCameraDistance(20, -120, bounds)).toBeLessThan(20);
  });

  it('a zero wheel delta leaves the distance unchanged', () => {
    expect(zoomCameraDistance(20, 0, bounds)).toBe(20);
  });

  it('is an exponential step: opposite deltas cancel each other out', () => {
    const out = zoomCameraDistance(20, 120, bounds);
    expect(zoomCameraDistance(out, -120, bounds)).toBeCloseTo(20);
  });

  it('equal deltas apply equal RATIOS regardless of the current distance', () => {
    const fromSmall = zoomCameraDistance(10, 120, bounds) / 10;
    const fromLarge = zoomCameraDistance(30, 120, bounds) / 30;
    expect(fromSmall).toBeCloseTo(fromLarge);
  });

  it('clamps at both bounds', () => {
    expect(zoomCameraDistance(39, 10_000, bounds)).toBe(40);
    expect(zoomCameraDistance(6, -10_000, bounds)).toBe(5);
  });
});

describe('zoomCameraDistanceByFactor (WU-VIEW-02)', () => {
  const bounds = { min: 5, max: 40 };

  it('factor > 1 zooms out, factor < 1 zooms in', () => {
    expect(zoomCameraDistanceByFactor(20, 1.25, bounds)).toBeCloseTo(25);
    expect(zoomCameraDistanceByFactor(20, 0.8, bounds)).toBeCloseTo(16);
  });

  it('reciprocal factors cancel each other out', () => {
    const out = zoomCameraDistanceByFactor(20, 1.25, bounds);
    expect(zoomCameraDistanceByFactor(out, 1 / 1.25, bounds)).toBeCloseTo(20);
  });

  it('clamps at both bounds', () => {
    expect(zoomCameraDistanceByFactor(39, 2, bounds)).toBe(40);
    expect(zoomCameraDistanceByFactor(6, 0.1, bounds)).toBe(5);
  });
});

describe('zoomPercentForDistance (WU-VIEW-02)', () => {
  it('is 100% at the reference framing distance', () => {
    expect(zoomPercentForDistance(20, 20)).toBe(100);
  });

  it('reads higher zoomed out and lower zoomed in', () => {
    expect(zoomPercentForDistance(20, 40)).toBe(50);
    expect(zoomPercentForDistance(20, 10)).toBe(200);
  });

  it('rounds to whole percents and survives a missing reference', () => {
    expect(zoomPercentForDistance(20, 15)).toBe(133);
    expect(zoomPercentForDistance(0, 15)).toBe(100);
  });
});

describe('panCameraTarget (WU-UX-01)', () => {
  const target = { x: 10, z: 20 };

  it('a zero drag leaves the target unchanged', () => {
    expect(panCameraTarget(target, 0, 0, 15, 600, 45, 45)).toEqual(target);
  });

  it('dragging right moves the target toward -x (content follows the cursor)', () => {
    const next = panCameraTarget(target, 50, 0, 15, 600, 45, 45);
    expect(next.x).toBeLessThan(target.x);
    expect(next.z).toBe(target.z);
  });

  it('dragging down moves the target toward -z (content follows the cursor)', () => {
    const next = panCameraTarget(target, 0, 50, 15, 600, 45, 45);
    expect(next.z).toBeLessThan(target.z);
    expect(next.x).toBe(target.x);
  });

  it('scales the world offset with camera distance (zoomed out pans farther per pixel)', () => {
    const near = panCameraTarget(target, 100, 0, 10, 600, 45, 45);
    const far = panCameraTarget(target, 100, 0, 20, 600, 45, 45);
    expect(target.x - far.x).toBeCloseTo((target.x - near.x) * 2);
  });

  it('foreshortens vertical drags by the 45-degree ground-plane tilt (1/sin(45) = sqrt(2))', () => {
    const horizontal = panCameraTarget(target, 100, 0, 15, 600, 45, 45);
    const vertical = panCameraTarget(target, 0, 100, 15, 600, 45, 45);
    expect(target.z - vertical.z).toBeCloseTo((target.x - horizontal.x) * Math.SQRT2);
  });

  it('matches the projection math: a small pan re-projects a fixed point by the same pixel offset', () => {
    // A drag of dy pixels must shift the projection of the ground point that
    // sat at screen center by dy/height screen fractions (the mapping is a
    // linearization at the look-at point, so keep the drag small).
    const distance = 15;
    const height = 600;
    const before = computeOverviewCameraPose(target.x, target.z, 45, distance);
    const next = panCameraTarget(target, 0, 6, distance, height, 45, 45);
    const after = computeOverviewCameraPose(next.x, next.z, 45, distance);
    const point = { x: target.x, y: 0, z: target.z };
    const projBefore = projectToScreenFraction(point, before, 45, 1);
    const projAfter = projectToScreenFraction(point, after, 45, 1);
    expect(projBefore?.yFrac).toBeCloseTo(0.5);
    // Content followed the cursor: the point moved DOWN by 6/600 = 0.01.
    expect(projAfter?.yFrac).toBeCloseTo(0.51, 2);
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
