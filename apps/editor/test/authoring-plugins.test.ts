import { parseEventScript } from '@threemaker/core';
import {
  createBlankMapDocument,
  parseMapDocument,
  serializeMapDocument,
} from '@threemaker/map-format';
import { describe, expect, it } from 'vitest';
import { authoringPlugins } from '../src/authoring-plugins.js';
import { validateEventsDraft } from '../src/painter-store.js';

const DEFAULT_FLAGS = new Array(8192).fill(0);

function playSoundDocJson(): unknown {
  const blank = createBlankMapDocument({
    id: 'audio-map',
    name: 'audio-map',
    width: 8,
    height: 8,
    slots: {},
    flags: DEFAULT_FLAGS,
  });
  return JSON.parse(
    serializeMapDocument({
      ...blank,
      events: {
        hit: [{ type: 'playSound', path: 'se/hit.ogg' } as never],
      },
    }),
  );
}

describe('authoringPlugins', () => {
  it('rejects playSound map documents without a registry', () => {
    expect(() => parseMapDocument(playSoundDocJson())).toThrow(/unknown command type "playSound"/);
  });

  it('loads playSound map documents with the authoring registry', () => {
    const doc = parseMapDocument(playSoundDocJson(), authoringPlugins());
    expect(doc.events.hit).toEqual([{ type: 'playSound', path: 'se/hit.ogg' }]);
  });

  it('validateEventsDraft accepts playSound via authoring plugins', () => {
    expect(
      validateEventsDraft({ hit: [{ type: 'playSound', path: 'se/hit.ogg' } as never] }),
    ).toBeNull();
  });

  it('validateEventsDraft still rejects unknown command types', () => {
    expect(validateEventsDraft({ hit: [{ type: 'notARealCommand' } as never] })).toMatch(
      /unknown command type/,
    );
  });

  it('parseEventScript rejects escaping audio paths through the authoring registry', () => {
    expect(() =>
      parseEventScript(
        { version: 1, events: { hit: [{ type: 'playSound', path: '../../etc/passwd' }] } },
        authoringPlugins(),
      ),
    ).toThrow(/".." segments/);
  });
});
