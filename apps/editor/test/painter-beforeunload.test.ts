/**
 * Pins window-close / refresh guards to the same dirty predicate as map-switch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PANEL_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/PainterPanel.tsx'),
  'utf8',
);

describe('Painter dirty beforeunload guard source pin', () => {
  it('registers beforeunload when shouldConfirmMapSwitch is true', () => {
    expect(PANEL_SOURCE).toMatch(
      /if \(!shouldConfirmMapSwitch\(\{ mapReady, docDirty, inkDirty \}\)\) return;/,
    );
    expect(PANEL_SOURCE).toContain("addEventListener('beforeunload'");
    expect(PANEL_SOURCE).toContain("removeEventListener('beforeunload'");
    expect(PANEL_SOURCE).toContain("t('painter.unsaved.closeConfirm')");
    expect(PANEL_SOURCE).toContain('onCloseRequested');
  });
});
