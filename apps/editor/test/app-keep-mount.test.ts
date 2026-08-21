/**
 * Pins the App.tsx call site of the keep-mount contract.
 *
 * `workspace-panels.test.ts` already locks the helper: both panels report
 * `alwaysMounted: true` and hide via class + inert. That suite stays green
 * if App switches to `{workspace === 'map' && <PainterPanel />}` — which
 * unmounts the WebGPU painter and wipes the unsaved session. This file
 * reads the shell source so that regression fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/App.tsx'),
  'utf8',
);

describe('App workspace keep-mount source pin', () => {
  it('mounts both panels from alwaysMounted, not the active workspace tab', () => {
    expect(APP_SOURCE).toContain('workspaceMountContract(workspace)');
    expect(APP_SOURCE).toContain('panels.map.alwaysMounted &&');
    expect(APP_SOURCE).toContain('panels.assets.alwaysMounted &&');
    expect(APP_SOURCE).toContain('<PainterPanel');
    expect(APP_SOURCE).not.toMatch(/workspace\s*===\s*['"]map['"]\s*&&/);
    expect(APP_SOURCE).not.toMatch(/workspace\s*===\s*['"]assets['"]\s*&&/);
  });
});
