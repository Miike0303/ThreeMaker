import { baseSceneLightSetup, mapHasAuthoredLights } from '@threemaker/renderer';
import { describe, expect, it } from 'vitest';
import {
  PAINTER_UNLIT_BASE,
  painterBaseLightSetup,
  painterPreviewLights,
  painterSheetLighting,
} from '../src/painter-lighting.js';

describe('painterSheetLighting', () => {
  it('is undefined when the map authors no lights (unlit Basic path)', () => {
    expect(painterSheetLighting([])).toBeUndefined();
    expect(mapHasAuthoredLights([])).toBe(false);
  });

  it('opts tiles into Lambert when the map authors at least one light', () => {
    expect(painterSheetLighting([{ id: 'light-1' }])).toEqual({ lit: true });
  });
});

describe('painterBaseLightSetup', () => {
  it('keeps the painter unlit chrome when there are no lights', () => {
    expect(painterBaseLightSetup([])).toEqual(PAINTER_UNLIT_BASE);
  });

  it('swaps to desktop lit ambient π and drops the directional', () => {
    expect(painterBaseLightSetup([{ id: 'light-1' }])).toEqual(baseSceneLightSetup(true));
    expect(baseSceneLightSetup(true).directional).toBeNull();
    expect(baseSceneLightSetup(true).ambient.intensity).toBe(Math.PI);
  });
});

describe('painterPreviewLights', () => {
  it('keeps placed lights on the active floor and every attached light', () => {
    const lights = [
      { id: 'a', floor: 'ground' },
      { id: 'b', floor: 'upstairs' },
      { id: 'torch', attach: 'player' },
    ];
    expect(painterPreviewLights(lights as never, 'ground').map((light) => light.id)).toEqual([
      'a',
      'torch',
    ]);
  });
});
