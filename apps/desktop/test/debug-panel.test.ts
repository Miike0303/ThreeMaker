import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDebugPanel,
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
      'debug.backend': 'Backend',
      'debug.frameMs': 'Frame ms',
      'debug.tile': 'Tile',
      'debug.elevation': 'Elevation',
      'debug.narrativeSprites': 'NPC sprites',
      'debug.props': 'Props',
      'debug.lights': 'Lights',
      'debug.hops': 'Map hops',
      'debug.lastHopSprites': 'Last hop NPC sprites',
      'debug.lastHopTextures': 'Last hop floor textures',
      'debug.lastHopPropInstances': 'Last hop prop instances',
      'debug.lastHopPropAssets': 'Last hop prop assets',
      'debug.lastHopLights': 'Last hop lights',
      'debug.inventory': 'Inventory',
      'debug.stats': 'Stats',
      'debug.clock': 'Clock',
      'debug.weather': 'Weather',
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
  lightInstances: 3,
  litTiles: true,
  backend: 'webgpu',
  frameTimeMs: 16.66,
  hopsCompleted: 2,
  lastOutgoingNarrativeSprites: 1,
  lastOutgoingFloorTextureKeys: 4,
  lastOutgoingPropInstances: 2,
  lastOutgoingPropAssets: 1,
  lastOutgoingLights: 2,
  inventory: { potion: 2, key: 1 },
  stats: { hp: 10, mp: 3 },
  clockMinutes: 480,
  weather: 'clear',
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
      { label: 'Backend', value: 'webgpu' },
      { label: 'Frame ms', value: '16.7' },
      { label: 'Tile', value: '10, 12' },
      { label: 'Elevation', value: '2' },
      { label: 'NPC sprites', value: '3' },
      { label: 'Props', value: '2' },
      { label: 'Lights', value: '3 (lit)' },
      { label: 'Map hops', value: '2' },
      { label: 'Last hop NPC sprites', value: '1' },
      { label: 'Last hop floor textures', value: '4' },
      { label: 'Last hop prop instances', value: '2' },
      { label: 'Last hop prop assets', value: '1' },
      { label: 'Last hop lights', value: '2' },
      { label: 'Inventory', value: '{key:1,potion:2}' },
      { label: 'Stats', value: '{hp:10,mp:3}' },
      { label: 'Clock', value: '08:00' },
      { label: 'Weather', value: 'clear' },
    ]);
  });

  it('does not mark unlit tiles as lit when light instances are present', () => {
    const rows = formatDebugRows(
      { ...SNAPSHOT, lightInstances: 4, litTiles: false },
      createI18n(LOCALES, 'en').t,
    );

    expect(rows.find((row) => row.label === 'Lights')?.value).toBe('4');
  });

  it('formats Lights as N when tiles are unlit, N (lit) when litTiles is true (C6 WU-04)', () => {
    const i18n = createI18n(LOCALES, 'en');
    const unlit = formatDebugRows({ ...SNAPSHOT, lightInstances: 0, litTiles: false }, i18n.t);
    const lit = formatDebugRows({ ...SNAPSHOT, lightInstances: 2, litTiles: true }, i18n.t);

    expect(unlit.find((r) => r.label === 'Lights')?.value).toBe('0');
    expect(lit.find((r) => r.label === 'Lights')?.value).toBe('2 (lit)');
  });

  it('shows the current weather after it changes from clear', () => {
    const rows = formatDebugRows({ ...SNAPSHOT, weather: 'rain' }, createI18n(LOCALES, 'en').t);

    expect(rows.find((row) => row.label === 'Weather')?.value).toBe('rain');
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

  it('shows a single inventory entry instead of an empty inventory', () => {
    const rows = formatDebugRows(
      { ...SNAPSHOT, inventory: { potion: 1 } },
      createI18n(LOCALES, 'en').t,
    );

    expect(rows.find((row) => row.label === 'Inventory')?.value).toBe('{potion:1}');
  });

  it('formats empty inventory and stats as compact braces', () => {
    const rows = formatDebugRows(
      { ...SNAPSHOT, inventory: {}, stats: {} },
      createI18n(LOCALES, 'en').t,
    );

    expect(rows.find((row) => row.label === 'Inventory')?.value).toBe('{}');
    expect(rows.find((row) => row.label === 'Stats')?.value).toBe('{}');
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

  it('starts expanded when reading collapsed state throws', () => {
    expect(
      readDebugPanelCollapsed({
        getItem: () => {
          throw new Error('Storage disabled');
        },
        setItem: () => {},
      }),
    ).toBe(false);
  });

  it('keeps the panel usable when persisting collapsed state throws', () => {
    expect(() =>
      writeDebugPanelCollapsed(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('Storage disabled');
          },
        },
        true,
      ),
    ).not.toThrow();
  });
});

type FakeNode = {
  readonly tag: string;
  textContent: string;
  readonly children: FakeNode[];
  readonly attributes: Map<string, string>;
  readonly listeners: Map<string, () => void>;
  readonly classList: { toggle(name: string, on?: boolean): void; contains(name: string): boolean };
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void): void;
  append(...nodes: unknown[]): void;
  appendChild(node: unknown): void;
};

function fakeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  const node: FakeNode = {
    tag,
    textContent: '',
    children: [],
    attributes: new Map(),
    listeners: new Map(),
    classList: {
      toggle: (name, on) => {
        if (on ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => {
      node.attributes.set(name, value);
    },
    addEventListener: (type, listener) => {
      node.listeners.set(type, listener);
    },
    append: (...nodes) => {
      node.children.push(...(nodes as FakeNode[]));
    },
    appendChild: (child) => {
      node.children.push(child as FakeNode);
    },
  };
  return node;
}

describe('debug panel toggle accessibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountPanel(
    storedCollapsed: boolean,
    devMode = false,
  ): {
    toggle: FakeNode;
    created: FakeNode[];
  } {
    const created: FakeNode[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const node = fakeNode(tag);
        created.push(node);
        return node;
      },
    });
    const store = new Map([[DEBUG_PANEL_COLLAPSED_STORAGE_KEY, String(storedCollapsed)]]);
    createDebugPanel(createI18n(LOCALES, 'en').t, {
      devMode,
      collapsedStorage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value);
        },
      },
    });
    const toggle = created.find((node) => node.tag === 'button');
    if (!toggle) throw new Error('debug panel created no toggle button');
    return { toggle, created };
  }

  it('reports the restored state and flips aria-expanded on each click', () => {
    const { toggle } = mountPanel(true);
    expect(toggle.attributes.get('aria-expanded')).toBe('false');

    toggle.listeners.get('click')?.();
    expect(toggle.attributes.get('aria-expanded')).toBe('true');

    toggle.listeners.get('click')?.();
    expect(toggle.attributes.get('aria-expanded')).toBe('false');
  });

  it('starts expanded when nothing collapsed was stored', () => {
    expect(mountPanel(false).toggle.attributes.get('aria-expanded')).toBe('true');
  });

  it('marks the panel collapsed until the user expands it', () => {
    const { toggle, created } = mountPanel(true);
    const panel = created[0];

    expect(panel?.classList.contains('debug-panel-collapsed')).toBe(true);
    toggle.listeners.get('click')?.();
    expect(panel?.classList.contains('debug-panel-collapsed')).toBe(false);
  });

  it('shows the collapsed and expanded arrow glyphs for each toggle state', () => {
    const { toggle } = mountPanel(true);

    expect(toggle.textContent).toBe('▸');
    toggle.listeners.get('click')?.();
    expect(toggle.textContent).toBe('▾');
  });

  it('omits the map-cycle shortcut in production mode', () => {
    const { created } = mountPanel(false, false);

    expect(created.some((node) => node.textContent === 'G')).toBe(false);
  });

  it('labels F5 as the save shortcut in production mode', () => {
    const { created } = mountPanel(false, false);
    const saveRow = created.find((node) => node.children[1]?.textContent === 'debug.controls.save');

    expect(saveRow?.children[0]?.textContent).toBe('F5');
  });

  it('includes the map-cycle control row in dev mode', () => {
    const { created } = mountPanel(false, true);

    expect(created.some((node) => node.textContent === 'G')).toBe(true);
  });

  it('labels Ctrl as the noclip shortcut', () => {
    const { created } = mountPanel(false);
    const controlRow = created.find(
      (node) =>
        node.className === 'debug-panel-row' &&
        node.children[1]?.textContent === 'debug.controls.noclip',
    );

    expect(controlRow?.children[0]?.textContent).toBe('Ctrl');
  });

  it('seeds the weather readout with clear before the first update', () => {
    const { created } = mountPanel(false);
    const weatherRow = created.find(
      (node) => node.className === 'debug-panel-row' && node.children[0]?.textContent === 'Weather',
    );

    expect(weatherRow?.children[1]?.textContent).toBe('clear');
  });

  it('shows noclip as on while the shortcut is active', () => {
    const created: FakeNode[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const node = fakeNode(tag);
        created.push(node);
        return node;
      },
    });
    const panel = createDebugPanel(createI18n(LOCALES, 'en').t, {
      devMode: false,
      collapsedStorage: { getItem: () => null, setItem: () => {} },
    });
    const indicator = created.find((node) => node.textContent === 'debug.noclipOff');

    panel.setNoclipActive(true);

    expect(indicator?.textContent).toBe('debug.noclipOn');
  });

  it('restores the noclip off indicator when the shortcut is released', () => {
    const created: FakeNode[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const node = fakeNode(tag);
        created.push(node);
        return node;
      },
    });
    const panel = createDebugPanel(createI18n(LOCALES, 'en').t, {
      devMode: false,
      collapsedStorage: { getItem: () => null, setItem: () => {} },
    });
    const indicator = created.find((node) => node.textContent === 'debug.noclipOff');

    panel.setNoclipActive(true);
    panel.setNoclipActive(false);

    expect(indicator?.textContent).toBe('debug.noclipOff');
  });

  it('refreshes the map value in its own row when the snapshot changes', () => {
    const created: FakeNode[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const node = fakeNode(tag);
        created.push(node);
        return node;
      },
    });
    const panel = createDebugPanel(createI18n(LOCALES, 'en').t, {
      devMode: false,
      collapsedStorage: { getItem: () => null, setItem: () => {} },
    });

    panel.update(SNAPSHOT);

    const mapRow = created.find(
      (node) => node.className === 'debug-panel-row' && node.children[0]?.textContent === 'Map',
    );
    expect(mapRow?.children[1]?.textContent).toBe('Map007');
  });

  it('restores the collapsed preference saved under the stable storage key', () => {
    const storage = {
      getItem: (key: string) => (key === 'threemaker:debugPanelCollapsed' ? 'true' : null),
      setItem: () => {},
    };

    expect(readDebugPanelCollapsed(storage)).toBe(true);
  });

  it('restores a user-collapsed panel after recreating the overlay', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => fakeNode(tag) });
    const store = new Map<string, string>();
    const options = {
      devMode: false,
      collapsedStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    };
    const panel = createDebugPanel(createI18n(LOCALES, 'en').t, options);
    const toggle = (panel.element as unknown as FakeNode).children[0]?.children[1];
    if (!toggle) throw new Error('debug panel created no toggle button');

    toggle.listeners.get('click')?.();
    const restored = createDebugPanel(createI18n(LOCALES, 'en').t, options);

    expect(
      (restored.element as unknown as FakeNode).classList.contains('debug-panel-collapsed'),
    ).toBe(true);
  });
});
