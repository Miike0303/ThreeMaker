import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createShadowMaterial, createSheetMaterials } from '../src/scene/sheet-materials.js';

describe('createSheetMaterials', () => {
  it('defaults every texture to the crisp no-mipmap configuration', () => {
    const texture = new THREE.Texture();

    createSheetMaterials({ B: texture });

    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
  });

  it('forwards textureOptions to every sheet texture (the HD-2D filtered-environment knob)', () => {
    const textureB = new THREE.Texture();
    const textureC = new THREE.Texture();

    createSheetMaterials({ B: textureB, C: textureC }, { mipmaps: true, maxAnisotropy: 4 });

    for (const texture of [textureB, textureC]) {
      expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.anisotropy).toBe(4);
      // magFilter stays nearest regardless -- close-up tiles stay crisp.
      expect(texture.magFilter).toBe(THREE.NearestFilter);
    }
  });

  it('builds one double-sided, alpha-tested material per sheet', () => {
    const materials = createSheetMaterials({ B: new THREE.Texture() });
    const material = materials.B as THREE.MeshBasicMaterial;

    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.alphaTest).toBeGreaterThan(0);
  });
});

describe('createShadowMaterial', () => {
  it('creates a translucent black overlay material with depth-write off', () => {
    const material = createShadowMaterial() as THREE.MeshBasicMaterial;

    expect(material.color.getHex()).toBe(0x000000);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.5);
    expect(material.depthWrite).toBe(false);
  });

  it('biases depth toward the camera (polygonOffset) so it never z-fights the ground it floats above regardless of camera distance', () => {
    const material = createShadowMaterial() as THREE.MeshBasicMaterial;

    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    expect(material.polygonOffsetUnits).toBeLessThan(0);
  });
});
