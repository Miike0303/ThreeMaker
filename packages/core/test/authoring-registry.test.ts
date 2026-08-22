import { describe, expect, it } from 'vitest';
import { authoringPlugins, createAuthoringCommandRegistry } from '../src/authoring-registry.js';
import { parseEventScript } from '../src/event-command.js';

describe('authoringPlugins', () => {
  it('accepts playSound on the shared parse-only registry', () => {
    const script = parseEventScript(
      { version: 1, events: { hit: [{ type: 'playSound', path: 'se/hit.ogg' }] } },
      authoringPlugins(),
    );
    expect(script.hit).toEqual([{ type: 'playSound', path: 'se/hit.ogg' }]);
  });

  it('createAuthoringCommandRegistry is a new instance each call', () => {
    expect(createAuthoringCommandRegistry()).not.toBe(createAuthoringCommandRegistry());
    expect(authoringPlugins()).toBe(authoringPlugins());
  });
});
