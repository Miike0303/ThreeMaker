/**
 * Maker Studio Map | Assets workspace panel props (pure).
 *
 * Critical UX contract: both panels always mount; only visibility/inert toggle.
 * Unmounting Map disposed PainterViewport and wiped unsaved sessions.
 */

export type WorkspaceId = 'map' | 'assets';

export type WorkspacePanelView = {
  readonly className: string;
  readonly ariaHidden: boolean;
  /** When true, set the HTML `inert` attribute on the panel. */
  readonly inert: boolean;
  /**
   * Always true — documents the keep-mounted contract for tests and call sites.
   * Callers must render the panel whenever this is true (i.e. always).
   */
  readonly alwaysMounted: true;
};

/**
 * Class names + a11y for one stacked workspace panel.
 * CSS rule of thumb: only `.app-workspace-panel-active` may set `display: flex`;
 * `.app-workspace-assets` must not override `display: none` on inactive panels.
 */
export function describeWorkspacePanel(
  panel: WorkspaceId,
  active: WorkspaceId,
): WorkspacePanelView {
  const isActive = panel === active;
  const parts = ['app-workspace-panel'];
  if (isActive) parts.push('app-workspace-panel-active');
  if (panel === 'assets') parts.push('app-workspace-assets');
  return {
    className: parts.join(' '),
    ariaHidden: !isActive,
    inert: !isActive,
    alwaysMounted: true,
  };
}

/** Both Map and Assets must report alwaysMounted for any active workspace. */
export function workspaceMountContract(active: WorkspaceId): {
  readonly map: WorkspacePanelView;
  readonly assets: WorkspacePanelView;
} {
  return {
    map: describeWorkspacePanel('map', active),
    assets: describeWorkspacePanel('assets', active),
  };
}

/**
 * Footer status line kind (caller supplies asset path text when kind is asset-path).
 */
export function footerStatusKind(
  active: WorkspaceId,
  hasSelectedAsset: boolean,
): 'asset-path' | 'map' | 'assets' {
  if (hasSelectedAsset) return 'asset-path';
  return active === 'map' ? 'map' : 'assets';
}
