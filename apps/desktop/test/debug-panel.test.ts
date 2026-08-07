import { describe, expect, it } from 'vitest';
import {
  DEBUG_PANEL_COLLAPSED_STORAGE_KEY,
  formatDebugRows,
  readDebugPanelCollapsed,
  writeDebugPanelCollapsed,
} from '../src/debug-panel.js';
import { createI18n } from '../src/i18n.js';

const LOCALES = {
  en: {
    name: 'English',
    strings: {
      'debug.map': 'Map',
      'debug.cameraMode': 'Camera',
      'debug.tilt': 'Tilt',
      'debug.zoom': 'Zoom',
      'debug.chunks': 'Chunks',
      'debug.drawCalls': 'Draw calls',
      'debug.tile': 'Tile',
      'debug.elevation': 'Elevation',
      'debug.narrativeSprites': 'NPC sprites',
      'debug.props': 'Props',
      'debug.hops': 'Map hops',
      'debug.lastHopSprites': 'Last hop NPC sprites',
      'debug.lastHopTextures': 'Last hop floor textures',
      'debug.lastHopPropInstances': 'Last hop prop instances',
      'debug.lastHopPropAssets': 'Last hop prop assets',
      'debug.inventory': 'Inventory',
      'debug.stats': 'Stats',
    },
  },
};

const SNAPSHOT = {
  mapName: 'Map007',
  cameraModeLabel: 'HD-2D',
  tiltDeg: 40.4,
  distance: 9.999,
  liveChunks: 4,
  drawCalls: 12,
  tile: { x: 10, y: 12 },
  elevation: 2,
  narrativeSprites: 3,
  propInstances: 2,
  hopsCompleted: 2,
  lastOutgoingNarrativeSprites: 1,
  lastOutgoingFloorTextureKeys: 4,
  lastOutgoingPropInstances: 2,
  lastOutgoingPropAssets: 1,
  inventory: { potion: 2, key: 1 },
  stats: { hp: 10, mp: 3 },
};

describe('formatDebugRows', () => {
  it('formats every live-value row with its localized label and a rounded value', () => {
    const i18n = createI18n(LOCALES, 'en');
    const rows = formatDebugRows(SNAPSHOT, i18n.t);

    expect(rows).toEqual([
      { label: 'Map', value: 'Map007' },
      { label: 'Camera', value: 'HD-2D' },
      { label: 'Tilt', value: '40°' },
      { label: 'Zoom', value: '10.0' },
      { label: 'Chunks', value: '4' },
      { label: 'Draw calls', value: '12' },
      { label: 'Tile', value: '10, 12' },
      { label: 'Elevation', value: '2' },
      { label: 'NPC sprites', value: '3' },
      { label: 'Props', value: '2' },
      { label: 'Map hops', value: '2' },
      { label: 'Last hop NPC sprites', value: '1' },
      { label: 'Last hop floor textures', value: '4' },
      { label: 'Last hop prop instances', value: '2' },
      { label: 'Last hop prop assets', value: '1' },
      { label: 'Inventory', value: '{key:1,potion:2}' },
      { label: 'Stats', value: '{hp:10,mp:3}' },
    ]);
  });

  it('exposes last-hop dispose counts for C1 GPU-leak debug-panel contract', () => {
    const i18n = createI18n(LOCALES, 'en');
    const rows = formatDebugRows(
      {
        ...SNAPSHOT,
        hopsCompleted: 0,
        lastOutgoingNarrativeSprites: 0,
        lastOutgoingFloorTextureKeys: 0,
      },
      i18n.t,
    );
    expect(rows.find((r) => r.label === 'Last hop NPC sprites')?.value).toBe('0');
    expect(rows.find((r) => r.label === 'Last hop floor textures')?.value).toBe('0');
  });

  it('rounds tilt to the nearest whole degree and zoom to one decimal', () => {
    const i18n = createI18n(LOCALES, 'en');
    const rows = formatDebugRows({ ...SNAPSHOT, tiltDeg: 74.6, distance: 3.04 }, i18n.t);

    expect(rows.find((r) => r.label === 'Tilt')?.value).toBe('75°');
    expect(rows.find((r) => r.label === 'Zoom')?.value).toBe('3.0');
  });
});

describe('debug panel collapsed-state persistence', () => {
  function createFakeStorage(initial: Record<string, string> = {}): Storage {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    } as Storage;
  }

  it('defaults to not collapsed when nothing was persisted yet', () => {
    const storage = createFakeStorage();
    expect(readDebugPanelCollapsed(storage)).toBe(false);
  });

  it('round-trips a collapsed=true write through the same storage key', () => {
    const storage = createFakeStorage();
    writeDebugPanelCollapsed(storage, true);
    expect(readDebugPanelCollapsed(storage)).toBe(true);
    expect(storage.getItem(DEBUG_PANEL_COLLAPSED_STORAGE_KEY)).toBe('true');
  });

  it('round-trips a collapsed=false write (not just "falsy absence")', () => {
    const storage = createFakeStorage({ [DEBUG_PANEL_COLLAPSED_STORAGE_KEY]: 'true' });
    writeDebugPanelCollapsed(storage, false);
    expect(readDebugPanelCollapsed(storage)).toBe(false);
  });

  it('treats a corrupt/unexpected stored value as not-collapsed rather than throwing', () => {
    const storage = createFakeStorage({ [DEBUG_PANEL_COLLAPSED_STORAGE_KEY]: 'garbage' });
    expect(readDebugPanelCollapsed(storage)).toBe(false);
  });
});
