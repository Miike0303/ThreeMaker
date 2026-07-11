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
    ]);
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
