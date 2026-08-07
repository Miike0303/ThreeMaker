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

  it('never receives a lightMap even when sheet materials are built with a lighting bag', () => {
    // createShadowMaterial is independent of createSheetMaterials; this documents
    // the contract that the shadow overlay stays unlit.
    const material = createShadowMaterial() as THREE.MeshBasicMaterial;
    expect(material.lightMap).toBeNull();
  });
});

describe('createSheetMaterials lighting bag (C6 WU-02)', () => {
  it('sets lightMap + intensity + channel 1 on every sheet material when lighting is provided', () => {
    const lightMap = new THREE.Texture();
    const materials = createSheetMaterials(
      { B: new THREE.Texture(), C: new THREE.Texture() },
      {},
      { lightMap, lightMapIntensity: 0.75 },
    );

    for (const sheet of ['B', 'C'] as const) {
      const material = materials[sheet] as THREE.MeshBasicMaterial;
      expect(material.lightMap).toBe(lightMap);
      expect(material.lightMapIntensity).toBeCloseTo(0.75);
    }
    expect(lightMap.channel).toBe(1);
  });

  it('defaults lightMapIntensity to 1 when omitted', () => {
    const lightMap = new THREE.Texture();
    const materials = createSheetMaterials({ B: new THREE.Texture() }, {}, { lightMap });
    expect((materials.B as THREE.MeshBasicMaterial).lightMapIntensity).toBe(1);
  });

  it('omitted lighting bag leaves materials with lightMap null (identical to pre-WU-02)', () => {
    const materials = createSheetMaterials({ B: new THREE.Texture(), C: new THREE.Texture() });
    for (const sheet of ['B', 'C'] as const) {
      expect((materials[sheet] as THREE.MeshBasicMaterial).lightMap).toBeNull();
    }
  });

  it('Material.clone() preserves lightMap and lightMapIntensity (room-clone path contract)', () => {
    const lightMap = new THREE.Texture();
    lightMap.channel = 1;
    const materials = createSheetMaterials(
      { B: new THREE.Texture() },
      {},
      { lightMap, lightMapIntensity: 0.4 },
    );
    const base = materials.B as THREE.MeshBasicMaterial;
    const clone = base.clone();

    expect(clone.lightMap).toBe(lightMap);
    expect(clone.lightMapIntensity).toBeCloseTo(0.4);
    // channel lives on the shared texture, so the clone sees the same assignment
    expect(clone.lightMap?.channel).toBe(1);
  });
});
