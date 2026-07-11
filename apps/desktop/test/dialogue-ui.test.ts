import { describe, expect, it } from 'vitest';
import {
  formatDialogueHint,
  formatSpeakerLabel,
  nextHighlightedIndex,
  resolveDialogueKeyAction,
} from '../src/dialogue-ui.js';
import { createI18n } from '../src/i18n.js';

const LOCALES = {
  en: {
    name: 'English',
    strings: {
      'dialogue.unknownSpeaker': 'Someone',
      'dialogue.hint.advance': 'E / Enter / Space to continue',
      'dialogue.hint.choice': '1-9 or arrows + Enter to choose',
    },
  },
};

describe('resolveDialogueKeyAction', () => {
  it.each([
    'e',
    'enter',
    ' ',
  ])('maps advance key %j to "advance" when no choices are pending', (key) => {
    expect(resolveDialogueKeyAction(key, false)).toEqual({ kind: 'advance' });
  });

  it.each([
    'e',
    'enter',
    ' ',
  ])('maps advance key %j to "confirmHighlighted" when choices are pending', (key) => {
    expect(resolveDialogueKeyAction(key, true)).toEqual({ kind: 'confirmHighlighted' });
  });

  it('is case-insensitive for advance keys', () => {
    expect(resolveDialogueKeyAction('E', false)).toEqual({ kind: 'advance' });
    expect(resolveDialogueKeyAction('Enter', true)).toEqual({ kind: 'confirmHighlighted' });
  });

  it('maps digit keys 1-9 to a zero-based chooseIndex only when choices are pending', () => {
    expect(resolveDialogueKeyAction('1', true)).toEqual({ kind: 'chooseIndex', index: 0 });
    expect(resolveDialogueKeyAction('9', true)).toEqual({ kind: 'chooseIndex', index: 8 });
    expect(resolveDialogueKeyAction('1', false)).toBeUndefined();
  });

  it('maps arrow keys to navigate deltas only when choices are pending', () => {
    expect(resolveDialogueKeyAction('ArrowUp', true)).toEqual({ kind: 'navigate', delta: -1 });
    expect(resolveDialogueKeyAction('ArrowLeft', true)).toEqual({ kind: 'navigate', delta: -1 });
    expect(resolveDialogueKeyAction('ArrowDown', true)).toEqual({ kind: 'navigate', delta: 1 });
    expect(resolveDialogueKeyAction('ArrowRight', true)).toEqual({ kind: 'navigate', delta: 1 });
    expect(resolveDialogueKeyAction('ArrowUp', false)).toBeUndefined();
  });

  it('returns undefined for an unmapped key', () => {
    expect(resolveDialogueKeyAction('q', true)).toBeUndefined();
    expect(resolveDialogueKeyAction('0', true)).toBeUndefined();
  });
});

describe('nextHighlightedIndex', () => {
  it('wraps forward past the last option back to 0', () => {
    expect(nextHighlightedIndex(2, 1, 3)).toBe(0);
  });

  it('wraps backward past 0 to the last option', () => {
    expect(nextHighlightedIndex(0, -1, 3)).toBe(2);
  });

  it('steps normally within bounds', () => {
    expect(nextHighlightedIndex(0, 1, 3)).toBe(1);
    expect(nextHighlightedIndex(1, -1, 3)).toBe(0);
  });

  it('returns 0 defensively when there are no options', () => {
    expect(nextHighlightedIndex(0, 1, 0)).toBe(0);
  });
});

describe('formatSpeakerLabel', () => {
  it('returns the given speaker unchanged when present', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(formatSpeakerLabel('Elder', i18n.t)).toBe('Elder');
  });

  it('falls back to the localized unknown-speaker chrome when absent', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(formatSpeakerLabel(undefined, i18n.t)).toBe('Someone');
  });
});

describe('formatDialogueHint', () => {
  it('returns the advance hint when no choices are pending', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(formatDialogueHint(false, i18n.t)).toBe('E / Enter / Space to continue');
  });

  it('returns the choice hint when choices are pending', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(formatDialogueHint(true, i18n.t)).toBe('1-9 or arrows + Enter to choose');
  });
});
