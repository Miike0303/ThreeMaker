import { describe, expect, it } from 'vitest';
import {
  describeWorkspacePanel,
  footerStatusKind,
  workspaceMountContract,
} from '../src/workspace-panels.js';

describe('describeWorkspacePanel', () => {
  it('keeps map mounted and active when workspace is map', () => {
    const map = describeWorkspacePanel('map', 'map');
    expect(map.alwaysMounted).toBe(true);
    expect(map.className).toBe('app-workspace-panel app-workspace-panel-active');
    expect(map.ariaHidden).toBe(false);
    expect(map.inert).toBe(false);
  });

  it('hides map with CSS classes only when browsing assets (still alwaysMounted)', () => {
    const map = describeWorkspacePanel('map', 'assets');
    expect(map.alwaysMounted).toBe(true);
    expect(map.className).toBe('app-workspace-panel');
    expect(map.className.includes('app-workspace-panel-active')).toBe(false);
    expect(map.ariaHidden).toBe(true);
    expect(map.inert).toBe(true);
  });

  it('never puts display-active class on inactive assets panel', () => {
    const assets = describeWorkspacePanel('assets', 'map');
    expect(assets.alwaysMounted).toBe(true);
    expect(assets.className).toBe('app-workspace-panel app-workspace-assets');
    expect(assets.className.includes('app-workspace-panel-active')).toBe(false);
    expect(assets.ariaHidden).toBe(true);
    expect(assets.inert).toBe(true);
  });

  it('activates assets with assets layout class', () => {
    const assets = describeWorkspacePanel('assets', 'assets');
    expect(assets.className).toBe(
      'app-workspace-panel app-workspace-panel-active app-workspace-assets',
    );
    expect(assets.ariaHidden).toBe(false);
    expect(assets.inert).toBe(false);
  });
});

describe('workspaceMountContract', () => {
  it('requires both panels mounted when map is active', () => {
    const c = workspaceMountContract('map');
    expect(c.map.alwaysMounted).toBe(true);
    expect(c.assets.alwaysMounted).toBe(true);
    expect(c.map.inert).toBe(false);
    expect(c.assets.inert).toBe(true);
  });

  it('requires both panels mounted when assets is active (map session preserved)', () => {
    const c = workspaceMountContract('assets');
    expect(c.map.alwaysMounted).toBe(true);
    expect(c.assets.alwaysMounted).toBe(true);
    expect(c.map.inert).toBe(true);
    expect(c.assets.inert).toBe(false);
    // Regression: switching to Assets must not drop the active class contract on Map
    // (unmount is forbidden; only active class controls display:flex).
    expect(c.map.className.includes('app-workspace-panel-active')).toBe(false);
  });
});

describe('footerStatusKind', () => {
  it('prefers selected asset path over workspace', () => {
    expect(footerStatusKind('map', true)).toBe('asset-path');
    expect(footerStatusKind('assets', true)).toBe('asset-path');
  });

  it('reflects workspace when no asset is selected', () => {
    expect(footerStatusKind('map', false)).toBe('map');
    expect(footerStatusKind('assets', false)).toBe('assets');
  });
});
