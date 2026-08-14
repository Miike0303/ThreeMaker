/**
 * Spawn-row floor label composition (WU-D). `resolveFloorLabel` already
 * returns a complete human-readable name (`Floor 1` / `Planta 1`, or a
 * custom label). Consumers must not prepend the same noun again.
 */
import { describe, expect, it } from 'vitest';
import { formatSpawnSummary, resolveFloorLabel } from '../src/floor-label.js';
import { createI18n } from '../src/i18n.js';
import en from '../src/locales/en.json' with { type: 'json' };
import es from '../src/locales/es.json' with { type: 'json' };

const unlabeled = [{ id: 'floor-0' }];
const custom = [{ id: 'floor-0', label: 'Basement' }];
const spawn = { floor: 'floor-0', x: 14, y: 4 };

function tFor(code: string) {
  return createI18n({ en, es }, code).t;
}

describe('resolveFloorLabel + spawn summary', () => {
  it('does not re-prefix a default English floor label in the spawn row', () => {
    const t = tFor('en');
    const label = resolveFloorLabel(unlabeled, 'floor-0', t);
    const summary = formatSpawnSummary(t, unlabeled, spawn);
    expect(label).toBe('Floor 1');
    expect(summary).toBe('Floor 1 at (14, 4)');
    expect(summary).not.toContain('Floor Floor');
  });

  it('does not re-prefix a default Spanish floor label in the spawn row', () => {
    const t = tFor('es');
    const label = resolveFloorLabel(unlabeled, 'floor-0', t);
    const summary = formatSpawnSummary(t, unlabeled, spawn);
    expect(label).toBe('Planta 1');
    expect(summary).toBe('Planta 1 en (14, 4)');
    expect(summary).not.toContain('Planta Planta');
  });

  it('does not prepend Floor/Planta to a custom floor name', () => {
    expect(formatSpawnSummary(tFor('en'), custom, spawn)).toBe('Basement at (14, 4)');
    expect(formatSpawnSummary(tFor('es'), custom, spawn)).toBe('Basement en (14, 4)');
  });
});
