import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DialogueSource } from '@threemaker/core';
import type { Story } from 'inkjs';
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
  it('returns choices immediately for a choice-only knot', () => {
    const story = compileInk('-> start\n=== start ===\n* [Yes] -> END\n* [No] -> END\n');
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });

    expect(provider.next()).toEqual({ kind: 'choices', options: ['Yes', 'No'] });
  });

  it('ends when the story produces only empty output', () => {
    const story = compileInk('-> start\n=== start ===\n-> END\n');
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });

    expect(provider.next()).toEqual({ kind: 'end' });
  });

  it('keeps an empty line when it has a speaker tag', () => {
    const story = compileInk('-> start\n=== start ===\n# speaker: Elder\n-> END\n');
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: '' });
  });

  it('finds the speaker tag after another tag', () => {
    const story = compileInk(
      '-> start\n=== start ===\nHello. # mood: calm # speaker: Elder\n-> END\n',
    );
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello.' });
  });

  it('keeps colons inside a speaker name', () => {
    const story = compileInk('Hello. # speaker: Dr: Vale\n-> END\n');
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });

    expect(provider.next()).toEqual({ kind: 'line', speaker: 'Dr: Vale', text: 'Hello.' });
  });

  it('open() without a knot resumes the story where it left off', () => {
    const story = compileInk('First.\nSecond.\n-> END\n');
    const provider = new InkDialogueProvider(new Map([['inline', story]]));

    provider.open({ kind: 'ink', storyId: 'inline' });
    expect(provider.next()).toEqual({ kind: 'line', text: 'First.' });

    provider.open({ kind: 'ink', storyId: 'inline' });
    expect(provider.next()).toEqual({ kind: 'line', text: 'Second.' });
  });

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

it('accepts whitespace around the speaker tag key', () => {
  const story = compileInk('Hello. # speaker : Elder\n-> END\n');
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello.' });
});

it('removes a trailing CRLF from a dialogue line', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Hello\r\n',
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Hello' });
});

it('preserves an internal line break when removing the final newline', () => {
  const story = {
    canContinue: true,
    Continue: () => 'First\nSecond\n',
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'First\nSecond' });
});

it('trims trailing whitespace from a speaker tag', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Hello\n',
    currentTags: ['speaker: Elder   '],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello' });
});

it('offers and follows the only pending dialogue choice', () => {
  const story = compileInk('-> start\n=== start ===\n* [Continue]\n  Welcome back.\n  -> END\n');
  const provider = new InkDialogueProvider(new Map([['single-choice', story]]));

  provider.open({ kind: 'ink', storyId: 'single-choice' });

  expect(provider.next()).toEqual({ kind: 'choices', options: ['Continue'] });
  provider.choose(0);
  expect(provider.next()).toEqual({ kind: 'line', text: 'Welcome back.' });
});

it('ignores a colonless tag whose prefix is speaker', () => {
  const story = compileInk('Hello. # speakerX\n-> END\n');
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Hello.' });
});

it('keeps the full speaker name without whitespace after the colon', () => {
  const story = compileInk('Hello. # speaker:Elder\n-> END\n');
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello.' });
});

it('ignores a weather tag when no speaker is declared', () => {
  const story = compileInk('Hello. # weather: rainy\n-> END\n');
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Hello.' });
});

it('trims leading whitespace from the speaker tag key', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Hello\n',
    currentTags: [' \t speaker: Elder'],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', speaker: 'Elder', text: 'Hello' });
});

it('continues past empty story output to the next dialogue line', () => {
  const output = [null, '', 'Welcome.\n'];
  let cursor = 0;
  const story = {
    get canContinue() {
      return cursor < output.length;
    },
    Continue: () => output[cursor++] ?? null,
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));
  provider.open({ kind: 'ink', storyId: 'inline' });
  expect(provider.next()).toEqual({ kind: 'line', text: 'Welcome.' });
  expect(provider.next()).toEqual({ kind: 'end' });
});

it('identifies choosing as the operation attempted before opening a story', () => {
  const provider = new InkDialogueProvider(new Map());
  expect(() => provider.choose(0)).toThrow('InkDialogueProvider: choose() called before open().');
});

it('identifies advancing as the operation attempted before opening a story', () => {
  const provider = new InkDialogueProvider(new Map());

  expect(() => provider.next()).toThrow('InkDialogueProvider: next() called before open().');
});

it('preserves an explicitly empty speaker name', () => {
  const story = compileInk('Hello. # speaker:\n-> END\n');
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', speaker: '', text: 'Hello.' });
});

it('preserves dialogue spaces before the final newline', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Wait...  \n',
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Wait...  ' });
});

it('preserves a trailing content line break before the final newline', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Wait.\n\n',
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));
  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Wait.\n' });
});

it('reports the rejected dialogue source kind', () => {
  const provider = makeProvider();

  expect(() => provider.open({ kind: 'text', lines: ['Hello.'] })).toThrow(
    'InkDialogueProvider only supports "ink" sources, got "text".',
  );
});

it('preserves a content carriage return before the final CRLF', () => {
  const story = {
    canContinue: true,
    Continue: () => 'Wait.\r\r\n',
    currentTags: [],
    currentChoices: [],
  } as unknown as Story;
  const provider = new InkDialogueProvider(new Map([['inline', story]]));

  provider.open({ kind: 'ink', storyId: 'inline' });

  expect(provider.next()).toEqual({ kind: 'line', text: 'Wait.\r' });
});
