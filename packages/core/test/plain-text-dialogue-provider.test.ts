import { describe, expect, it } from 'vitest';
import { PlainTextDialogueProvider } from '../src/plain-text-dialogue-provider.js';

describe('PlainTextDialogueProvider', () => {
  it('steps through lines in order, then reports end', () => {
    const provider = new PlainTextDialogueProvider();

    provider.open({ kind: 'text', lines: ['Hello.', 'How are you?'] });

    expect(provider.next()).toEqual({ kind: 'line', text: 'Hello.' });
    expect(provider.next()).toEqual({ kind: 'line', text: 'How are you?' });
    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('keeps reporting end after the last line on further next() calls', () => {
    const provider = new PlainTextDialogueProvider();
    provider.open({ kind: 'text', lines: ['Only line.'] });

    provider.next();

    expect(provider.next()).toEqual({ kind: 'end' });
    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('reports end immediately for a source with no lines', () => {
    const provider = new PlainTextDialogueProvider();

    provider.open({ kind: 'text', lines: [] });

    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('restarts from the first line when open() is called again', () => {
    const provider = new PlainTextDialogueProvider();
    provider.open({ kind: 'text', lines: ['First.', 'Second.'] });
    provider.next();

    provider.open({ kind: 'text', lines: ['Restarted.'] });

    expect(provider.next()).toEqual({ kind: 'line', text: 'Restarted.' });
  });

  it('throws when opened with a non-text source', () => {
    const provider = new PlainTextDialogueProvider();

    expect(() => provider.open({ kind: 'ink', storyId: 'guard' })).toThrow(
      'PlainTextDialogueProvider only supports "text" sources, got "ink".',
    );
  });

  it('throws when next() is called before open()', () => {
    const provider = new PlainTextDialogueProvider();

    expect(() => provider.next()).toThrow(
      'PlainTextDialogueProvider: next() called before open().',
    );
  });

  it('throws when choose() is called, since plain text never presents choices', () => {
    const provider = new PlainTextDialogueProvider();
    provider.open({ kind: 'text', lines: ['Hello.'] });

    expect(() => provider.choose(0)).toThrow(
      'PlainTextDialogueProvider: choose() is not supported — plain text has no choices.',
    );
  });
});
