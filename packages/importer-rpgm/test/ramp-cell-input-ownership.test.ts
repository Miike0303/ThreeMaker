/**
 * Pins the single RampCellInput ownership: map-format defines it;
 * importer-rpgm re-exports and must not redeclare the interface.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ELEVATION_SOURCE = readFileSync(join(SRC, 'elevation.ts'), 'utf8');

describe('RampCellInput ownership', () => {
  it('re-exports RampCellInput from @threemaker/map-format', () => {
    expect(ELEVATION_SOURCE).toMatch(
      /export type \{\s*RampCellInput\s*\}\s*from\s*'@threemaker\/map-format'/,
    );
    expect(ELEVATION_SOURCE).not.toMatch(/export interface RampCellInput/);
  });
});
