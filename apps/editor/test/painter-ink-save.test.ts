/**
 * Pins the unified Save path: map Ctrl+S / toolbar Save must flush dirty Ink.
 *
 * A helper-only suite stays green if handleSave keeps calling only
 * saveMapDocument. This file reads the panel source so that regression fails.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PANEL_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/PainterPanel.tsx'),
  'utf8',
);

describe('Painter Save flushes Ink', () => {
  it('handleSave awaits inkSaveRef.saveIfDirty after saveMapDocument', () => {
    expect(PANEL_SOURCE).toContain('await saveMapDocument(doc, openMapName)');
    expect(PANEL_SOURCE).toContain('inkSaveRef.current?.saveIfDirty()');
    expect(PANEL_SOURCE).toContain('shouldConfirmMapSwitch({ mapReady, docDirty, inkDirty })');
  });

  it('handlePlaytest also flushes dirty Ink before openPlaytest', () => {
    const playtestFn = PANEL_SOURCE.match(
      /const handlePlaytest = useCallback\(async \(\) => \{[\s\S]*?\}, \[t, reportStatus, openMapName, refreshSavedMaps\]\);/,
    );
    expect(playtestFn?.[0]).toBeDefined();
    expect(playtestFn?.[0]).toContain('inkSaveRef.current?.saveIfDirty()');
    expect(playtestFn?.[0]).toContain('await openPlaytest()');
    // Flush must happen before launch so the sidecar on disk matches the buffer.
    const flushAt = playtestFn?.[0].indexOf('saveIfDirty()') ?? -1;
    const launchAt = playtestFn?.[0].indexOf('await openPlaytest()') ?? -1;
    expect(flushAt).toBeGreaterThan(-1);
    expect(launchAt).toBeGreaterThan(flushAt);
  });
});
