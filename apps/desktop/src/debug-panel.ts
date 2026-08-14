import { formatClockMinutes } from '@threemaker/renderer';
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
  /** Live NPC sprite meshes from the current map's narrative bundle (0 if none). */
  readonly narrativeSprites: number;
  /** Live prop instances from the current map's props bundle (0 if none). */
  readonly propInstances: number;
  /** Live authored light instances from the current map's lights bundle (0 if none). */
  readonly lightInstances: number;
  /**
   * Whether tile sheet materials are lit (Lambert) for this map — true when
   * the map authors at least one light (C6 WU-04 opt-in).
   */
  readonly litTiles: boolean;
  /** Active renderer backend label (`webgpu` / `webgl2`). */
  readonly backend: string;
  /** EMA frame time in milliseconds (display-rounded in {@link formatDebugRows}). */
  readonly frameTimeMs: number;
  /** Successful G-cycle / transferMap hops completed this session. */
  readonly hopsCompleted: number;
  /**
   * NPC sprites on the map disposed at the last completed hop (0 before any
   * hop). PLAN_DEV_2 C1: GPU-leak contract, debug-panel verifiable.
   */
  readonly lastOutgoingNarrativeSprites: number;
  /** Floor texture keys disposed with the outgoing map at the last hop. */
  readonly lastOutgoingFloorTextureKeys: number;
  /** Prop instances disposed with the outgoing map at the last hop (C5). */
  readonly lastOutgoingPropInstances: number;
  /** Distinct prop glTF assets disposed with the outgoing map at the last hop (C5). */
  readonly lastOutgoingPropAssets: number;
  /** Authored lights disposed with the outgoing map at the last hop (C6). */
  readonly lastOutgoingLights: number;
  /** Current session inventory counts (display-only; C4). */
  readonly inventory: Readonly<Record<string, number>>;
  /** Current session stat values (display-only; C4). */
  readonly stats: Readonly<Record<string, number>>;
  /**
   * Simulated clock minutes-of-day (C7). Displayed as HH:MM via
   * {@link formatClockMinutes} in {@link formatDebugRows}.
   */
  readonly clockMinutes: number;
  /**
   * Current weather mode string (C8). Displayed as-is (clear/rain/snow/fog).
   */
  readonly weather: string;
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
    { label: t('debug.backend'), value: snapshot.backend },
    { label: t('debug.frameMs'), value: snapshot.frameTimeMs.toFixed(1) },
    { label: t('debug.tile'), value: `${snapshot.tile.x}, ${snapshot.tile.y}` },
    { label: t('debug.elevation'), value: String(snapshot.elevation) },
    { label: t('debug.narrativeSprites'), value: String(snapshot.narrativeSprites) },
    { label: t('debug.props'), value: String(snapshot.propInstances) },
    {
      label: t('debug.lights'),
      // C6 WU-04: smallest headless-observable lit-mode signal on the existing row.
      value: snapshot.litTiles
        ? `${snapshot.lightInstances} (lit)`
        : String(snapshot.lightInstances),
    },
    { label: t('debug.hops'), value: String(snapshot.hopsCompleted) },
    {
      label: t('debug.lastHopSprites'),
      value: String(snapshot.lastOutgoingNarrativeSprites),
    },
    {
      label: t('debug.lastHopTextures'),
      value: String(snapshot.lastOutgoingFloorTextureKeys),
    },
    {
      label: t('debug.lastHopPropInstances'),
      value: String(snapshot.lastOutgoingPropInstances),
    },
    {
      label: t('debug.lastHopPropAssets'),
      value: String(snapshot.lastOutgoingPropAssets),
    },
    {
      label: t('debug.lastHopLights'),
      value: String(snapshot.lastOutgoingLights),
    },
    {
      label: t('debug.inventory'),
      value: formatRecordSnapshot(snapshot.inventory),
    },
    {
      label: t('debug.stats'),
      value: formatRecordSnapshot(snapshot.stats),
    },
    {
      label: t('debug.clock'),
      value: formatClockMinutes(snapshot.clockMinutes),
    },
    {
      label: t('debug.weather'),
      value: snapshot.weather,
    },
  ];
}

/** Compact `{a:1,b:2}` readout; empty object as `{}`. */
function formatRecordSnapshot(record: Readonly<Record<string, number>>): string {
  const keys = Object.keys(record).sort();
  if (keys.length === 0) return '{}';
  return `{${keys.map((k) => `${k}:${record[k]}`).join(',')}}`;
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
  { keys: 'Ctrl', labelKey: 'debug.controls.noclip' },
  { keys: 'F5', labelKey: 'debug.controls.save' },
  { keys: 'F9', labelKey: 'debug.controls.load' },
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
  /**
   * Toggles the noclip debug-mode indicator (rpgm-whole-game-import: held
   * Ctrl). Deliberately a separate method rather than a `DebugSnapshot`
   * field/`formatDebugRows` row: noclip only ever flips on a keydown/keyup
   * edge (not every 4 Hz `update()` tick), and keeping it out of
   * `formatDebugRows` avoids touching that function's existing exact-row
   * assertions (`debug-panel.test.ts`) for an unrelated feature.
   */
  setNoclipActive(active: boolean): void;
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
      narrativeSprites: 0,
      propInstances: 0,
      lightInstances: 0,
      litTiles: false,
      backend: '',
      frameTimeMs: 0,
      hopsCompleted: 0,
      lastOutgoingNarrativeSprites: 0,
      lastOutgoingFloorTextureKeys: 0,
      lastOutgoingPropInstances: 0,
      lastOutgoingPropAssets: 0,
      lastOutgoingLights: 0,
      inventory: {},
      stats: {},
      clockMinutes: 0,
      weather: 'clear',
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

  // Noclip indicator (rpgm-whole-game-import): a standalone row, not part
  // of `formatDebugRows`'s array -- see `DebugPanel.setNoclipActive`'s doc
  // comment for why. Always present (shows OFF by default) rather than
  // hidden/shown, so its position in the panel never shifts.
  const noclipRow = document.createElement('div');
  noclipRow.className = 'debug-panel-row';
  const noclipLabel = document.createElement('span');
  noclipLabel.className = 'debug-panel-label';
  noclipLabel.textContent = t('debug.noclip');
  const noclipValue = document.createElement('span');
  noclipValue.className = 'debug-panel-value';
  noclipValue.textContent = t('debug.noclipOff');
  noclipRow.append(noclipLabel, noclipValue);
  valuesSection.appendChild(noclipRow);

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
    setNoclipActive(active: boolean): void {
      noclipValue.textContent = active ? t('debug.noclipOn') : t('debug.noclipOff');
    },
  };
}
