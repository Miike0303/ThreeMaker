import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DialogueSource } from '@threemaker/core';
import { describe, expect, it } from 'vitest';
import { compileInk } from '../src/compile.js';
import { InkDialogueProvider } from '../src/ink-dialogue-provider.js';

const inkFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ink');
const dialogueSource = readFileSync(path.join(inkFixturesDir, 'dialogue-provider.ink'), 'utf-8');

function makeProvider(): InkDialogueProvider {
  const story = compileInk(dialogueSource);
  return new InkDialogueProvider(new Map([['elder', story]]));
}

describe('InkDialogueProvider', () => {
  it('steps through lines with speaker tags, then choices, then end', () => {
    const provider = makeProvider();
    const source: DialogueSource = { kind: 'ink', storyId: 'elder', knot: 'start' };

    provider.open(source);

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello, traveler.' });
    expect(provider.next()).toEqual({
      kind: 'choices',
      options: ['Ask about the weather', 'Say goodbye'],
    });
  });

  it('choose() advances down the selected branch', () => {
    const provider = makeProvider();
    provider.open({ kind: 'ink', storyId: 'elder', knot: 'start' });
    provider.next(); // line
    provider.next(); // choices

    provider.choose(0);

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: "It's sunny today." });
    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('choosing the other branch produces a different line', () => {
    const provider = makeProvider();
    provider.open({ kind: 'ink', storyId: 'elder', knot: 'start' });
    provider.next(); // line
    provider.next(); // choices

    provider.choose(1);

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Farewell.' });
    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('open() throws for a non-ink source', () => {
    const provider = makeProvider();

    expect(() => provider.open({ kind: 'text', lines: ['hi'] })).toThrow(
      /only supports "ink" sources/,
    );
  });

  it('open() throws for an unregistered storyId', () => {
    const provider = makeProvider();

    expect(() => provider.open({ kind: 'ink', storyId: 'unknown' })).toThrow(
      /no story registered for storyId "unknown"/,
    );
  });

  it('next() throws when called before open()', () => {
    const provider = makeProvider();

    expect(() => provider.next()).toThrow(/before open\(\)/);
  });

  it('choose() throws when called before open()', () => {
    const provider = makeProvider();

    expect(() => provider.choose(0)).toThrow(/before open\(\)/);
  });

  it('choose() throws when there are no pending choices', () => {
    const provider = makeProvider();
    provider.open({ kind: 'ink', storyId: 'elder', knot: 'start' });

    expect(() => provider.choose(0)).toThrow(
      'InkDialogueProvider: choose() called with no pending choices.',
    );
  });
});
