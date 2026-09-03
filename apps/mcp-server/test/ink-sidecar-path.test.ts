/**
 * MCP must not re-own Ink sidecar path helpers — they live in map-format.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inkSidecarRelativePath, isSafeStoryId } from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('MCP ink sidecar path uses map-format', () => {
  it('does not keep a local ink-sidecar-path module', () => {
    expect(existsSync(join(SRC, 'ink-sidecar-path.ts'))).toBe(false);
  });

  it('shared helpers still reject unsafe story ids', () => {
    expect(isSafeStoryId('../evil')).toBe(false);
    expect(inkSidecarRelativePath('current.tmmap.json', 'intro')).toBe('current.intro.ink');
  });
});
