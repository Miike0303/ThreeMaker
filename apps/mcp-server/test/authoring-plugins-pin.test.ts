/**
 * Pins MCP to the shared core authoring registry.
 *
 * A local `function authoringPlugins` in project-session stays green for
 * today's audio verbs and silently drifts the first time a new command is
 * registered only in the editor. This file reads the session source so that
 * regression fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SESSION_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/project-session.ts'),
  'utf8',
);

describe('MCP authoring registry source pin', () => {
  it('imports authoringPlugins from @threemaker/core, not a local builder', () => {
    expect(SESSION_SOURCE).toMatch(/authoringPlugins/);
    expect(SESSION_SOURCE).toMatch(/from '@threemaker\/core'/);
    expect(SESSION_SOURCE).not.toMatch(/function authoringPlugins/);
    expect(SESSION_SOURCE).not.toMatch(/createAudioCommandPlugins/);
  });
});
