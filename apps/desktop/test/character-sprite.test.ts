import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { CharacterSprite } from '../src/character-sprite.js';

function makeSprite(): CharacterSprite {
  return new CharacterSprite({ texture: new THREE.Texture() });
}

function makeCamera(x: number, y: number, z: number): THREE.Camera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

describe('CharacterSprite.faceCamera', () => {
  it('is idempotent: repeated calls without a setTilePosition in between do not accumulate drift', () => {
    const sprite = makeSprite();
    const camera = makeCamera(10, 5, 10);

    sprite.setTilePosition(5, 5);
    const basePosition = sprite.mesh.position.clone();

    for (let i = 0; i < 100; i++) {
      sprite.faceCamera(camera);
    }

    const drift = sprite.mesh.position.distanceTo(basePosition);
    // A single faceCamera call nudges by cameraBias (default 0.02) toward the
    // camera. 100 calls with the old mutating/accumulative implementation
    // would drift toward the camera by ~100x that amount; idempotent
    // behavior must stay within one bias step of the base tile position.
    expect(drift).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('keeps the existing player flow working: setTilePosition -> faceCamera -> setTilePosition -> faceCamera', () => {
    const sprite = makeSprite();
    const camera = makeCamera(10, 5, 10);

    sprite.setTilePosition(5, 5);
    sprite.faceCamera(camera);
    const afterFirst = sprite.mesh.position.clone();

    sprite.setTilePosition(6, 6);
    sprite.faceCamera(camera);
    const afterSecond = sprite.mesh.position.clone();

    // Moving to a different tile then facing the camera again should move
    // the mesh to be near the new tile center, not the old one.
    expect(afterSecond.distanceTo(afterFirst)).toBeGreaterThan(0.5);

    // And calling faceCamera again at the same tile must not move it further.
    sprite.faceCamera(camera);
    const afterThird = sprite.mesh.position.clone();
    expect(afterThird.distanceTo(afterSecond)).toBeLessThanOrEqual(1e-9);
  });
});
