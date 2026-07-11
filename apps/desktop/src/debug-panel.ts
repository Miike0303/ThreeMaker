import type { I18n } from './i18n.js';

/** One frame of the debug overlay's "live values" section (see main.ts's `window.__threemaker_debug`). */
export interface DebugSnapshot {
  readonly mapName: string;
  /** Already localized (reuses `CAMERA_MODE_LOCALE_KEY` in main.ts) -- this module stays decoupled from `CameraMode`. */
  readonly cameraModeLabel: string;
  readonly tiltDeg: number;
  readonly distance: number;
  readonly liveChunks: number;
  readonly drawCalls: number;
  readonly tile: { readonly x: number; readonly y: number };
  readonly elevation: number;
}

export interface DebugRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Formats one snapshot into the ordered rows the debug panel's "live values"
 * section renders. Pure and DOM-free so it's unit-testable without a browser
 * environment (this repo's vitest config runs under `environment: 'node'`).
 * Rounds display-only: `tiltDeg`/`distance` stay full precision everywhere
 * else (camera math, localStorage, etc.) -- only this formatted string is
 * rounded, purely for a stable, non-jittery readout at the panel's 4 Hz
 * refresh rate.
 */
export function formatDebugRows(snapshot: DebugSnapshot, t: I18n['t']): readonly DebugRow[] {
  return [
    { label: t('debug.map'), value: snapshot.mapName },
    { label: t('debug.cameraMode'), value: snapshot.cameraModeLabel },
    { label: t('debug.tilt'), value: `${Math.round(snapshot.tiltDeg)}°` },
    { label: t('debug.zoom'), value: snapshot.distance.toFixed(1) },
    { label: t('debug.chunks'), value: String(snapshot.liveChunks) },
    { label: t('debug.drawCalls'), value: String(snapshot.drawCalls) },
    { label: t('debug.tile'), value: `${snapshot.tile.x}, ${snapshot.tile.y}` },
    { label: t('debug.elevation'), value: String(snapshot.elevation) },
  ];
}

/** One control-cheat-sheet row: a key/chord plus its localized action description. */
export interface ControlRow {
  readonly keys: string;
  readonly labelKey: string;
}

// Always-available rows (production + dev): the panel's own collapse control
// aside, every one of these is a real engine feature (camera rig, post-fx
// toggle), not a dev-only tool -- see `README`/task notes: only the map-cycle
// row below is dev-gated.
export const CONTROL_ROWS: readonly ControlRow[] = [
  { keys: 'WASD / ↑←↓→', labelKey: 'debug.controls.move' },
  { keys: 'C', labelKey: 'debug.controls.camera' },
  { keys: '[ / ]', labelKey: 'debug.controls.tilt' },
  { keys: '- / =', labelKey: 'debug.controls.zoom' },
  { keys: 'P', labelKey: 'debug.controls.postfx' },
];

/** Dev-only cheat-sheet row (mirrors the `g` map-cycle toggle in main.ts, DEV-gated there too). */
export const DEV_CONTROL_ROW: ControlRow = { keys: 'G', labelKey: 'debug.controls.mapCycle' };

/** `localStorage` key the panel's collapsed/expanded state is persisted under. */
export const DEBUG_PANEL_COLLAPSED_STORAGE_KEY = 'threemaker:debugPanelCollapsed';

/** Storage shape this module needs -- `Pick<Storage, ...>` so a test double doesn't need to implement the full `Storage` interface. */
export type CollapsedStateStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Reads the panel's persisted collapsed state. Defaults to `false` (expanded)
 * when nothing was persisted yet, when the stored value isn't one of the two
 * strings `writeDebugPanelCollapsed` ever writes, or when the storage API
 * itself throws (e.g. SecurityError with storage disabled) -- a debug-only
 * nicety must never abort scene boot.
 */
export function readDebugPanelCollapsed(storage: CollapsedStateStorage): boolean {
  try {
    return storage.getItem(DEBUG_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persists the panel's collapsed/expanded state so it survives a reload. A throwing storage API (disabled/blocked) downgrades to not persisting. */
export function writeDebugPanelCollapsed(storage: CollapsedStateStorage, collapsed: boolean): void {
  try {
    storage.setItem(DEBUG_PANEL_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Persisting the toggle is best-effort only.
  }
}

export interface DebugPanelOptions {
  /** Storage the collapsed/expanded toggle persists to -- pass `localStorage` in the app. */
  readonly collapsedStorage: CollapsedStateStorage;
  /**
   * Whether to include the dev-only map-cycle ('g') cheat-sheet row. The
   * rest of the panel (live values + every other control row) is a real
   * engine feature and stays available in production builds -- only this
   * one row mirrors a dev-only toggle (see main.ts's `g` handler, itself
   * `import.meta.env.DEV`-gated).
   */
  readonly devMode: boolean;
}

export interface DebugPanel {
  readonly element: HTMLElement;
  /** Repaints the live-values section from a fresh snapshot. Call at a low rate (e.g. 4 Hz) -- see main.ts; not meant to be called per rendered frame. */
  update(snapshot: DebugSnapshot): void;
}

/**
 * Builds the collapsible debug/controls overlay: live engine values on top,
 * a static control cheat-sheet below. DOM construction, not unit-tested here
 * (this repo's vitest config runs under `environment: 'node'`, no `document`)
 * -- the pure formatting/persistence helpers above carry the tested logic;
 * this function is thin wiring over them, the same split `main.ts` already
 * uses for its own DOM-building (e.g. `buildLocaleSelector`).
 */
export function createDebugPanel(t: I18n['t'], options: DebugPanelOptions): DebugPanel {
  const panel = document.createElement('div');
  panel.className = 'debug-panel';

  const header = document.createElement('div');
  header.className = 'debug-panel-header';

  const title = document.createElement('span');
  title.className = 'debug-panel-title';
  title.textContent = t('debug.title');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'debug-panel-toggle';
  toggle.setAttribute('aria-label', t('debug.toggle'));

  header.append(title, toggle);

  const body = document.createElement('div');
  body.className = 'debug-panel-body';

  const valuesSection = document.createElement('div');
  valuesSection.className = 'debug-panel-values';
  // Indexed (not keyed by label text) so a locale switch that changes a
  // label string can never desync `update()` from the row it should patch.
  const valueEls: HTMLElement[] = [];
  // Seeded with a zeroed snapshot so every row/label exists before the first
  // `update()` call (the panel renders once before the game loop's first
  // 4 Hz tick).
  for (const row of formatDebugRows(
    {
      mapName: '',
      cameraModeLabel: '',
      tiltDeg: 0,
      distance: 0,
      liveChunks: 0,
      drawCalls: 0,
      tile: { x: 0, y: 0 },
      elevation: 0,
    },
    t,
  )) {
    const rowEl = document.createElement('div');
    rowEl.className = 'debug-panel-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'debug-panel-label';
    labelEl.textContent = row.label;
    const valueEl = document.createElement('span');
    valueEl.className = 'debug-panel-value';
    valueEl.textContent = row.value;
    rowEl.append(labelEl, valueEl);
    valuesSection.appendChild(rowEl);
    valueEls.push(valueEl);
  }

  const controlsSection = document.createElement('div');
  controlsSection.className = 'debug-panel-controls';
  const controlsTitle = document.createElement('div');
  controlsTitle.className = 'debug-panel-controls-title';
  controlsTitle.textContent = t('debug.controls.title');
  controlsSection.appendChild(controlsTitle);

  const rows = options.devMode ? [...CONTROL_ROWS, DEV_CONTROL_ROW] : CONTROL_ROWS;
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'debug-panel-row';
    const keysEl = document.createElement('span');
    keysEl.className = 'debug-panel-keys';
    keysEl.textContent = row.keys;
    const labelEl = document.createElement('span');
    labelEl.className = 'debug-panel-label';
    labelEl.textContent = t(row.labelKey);
    rowEl.append(keysEl, labelEl);
    controlsSection.appendChild(rowEl);
  }

  body.append(valuesSection, controlsSection);
  panel.append(header, body);

  function applyCollapsed(collapsed: boolean): void {
    panel.classList.toggle('debug-panel-collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '▾';
  }

  let collapsed = readDebugPanelCollapsed(options.collapsedStorage);
  applyCollapsed(collapsed);
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed(collapsed);
    writeDebugPanelCollapsed(options.collapsedStorage, collapsed);
  });

  return {
    element: panel,
    update(snapshot: DebugSnapshot): void {
      formatDebugRows(snapshot, t).forEach((row, index) => {
        const valueEl = valueEls[index];
        if (valueEl) valueEl.textContent = row.value;
      });
    },
  };
}
