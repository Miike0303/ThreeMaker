import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDialogueOverlay,
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

  it('falls back when the speaker tag is empty or whitespace', () => {
    const i18n = createI18n(LOCALES, 'en');
    expect(formatSpeakerLabel('', i18n.t)).toBe('Someone');
    expect(formatSpeakerLabel('   ', i18n.t)).toBe('Someone');
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

type FakeElement = {
  className: string;
  textContent: string;
  style: { display: string };
  dataset: Record<string, string>;
  children: FakeElement[];
  classList: {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, on?: boolean): void;
  };
  append(...nodes: FakeElement[]): void;
  replaceChildren(...nodes: FakeElement[]): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
};

function fakeElement(): FakeElement {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const element: FakeElement = {
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    className: '',
    textContent: '',
    style: { display: '' },
    dataset: {},
    children: [],
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, on) => ((on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)),
    },
    append: (...nodes) => element.children.push(...nodes),
    replaceChildren: (...nodes) => {
      element.children = nodes;
    },
  };
  return element;
}

describe('createDialogueOverlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function overlayParts() {
    vi.stubGlobal('document', { createElement: () => fakeElement() });
    const overlay = createDialogueOverlay(createI18n(LOCALES, 'en').t);
    const [speaker, text, choices] = (overlay.element as unknown as FakeElement).children;
    return { overlay, speaker, text, choices };
  }

  it('does not carry the previous speaker and line into a conversation that opens with choices', () => {
    const { overlay, speaker, text, choices } = overlayParts();
    const element = overlay.element as unknown as FakeElement;

    expect(element.getAttribute('aria-live')).toBe('polite');
    expect(element.getAttribute('aria-atomic')).toBe('true');

    overlay.showLine('Alice', 'Old conversation');
    expect(element.getAttribute('aria-live')).toBe('polite');
    overlay.hide();
    expect(element.getAttribute('aria-live')).toBe('polite');
    overlay.showChoices(['New option'], 0);
    expect(element.getAttribute('aria-live')).toBe('polite');

    expect(speaker?.textContent).toBe('');
    expect(text?.textContent).toBe('');
    expect(choices?.children).toHaveLength(1);
  });

  it('keeps the current prompt above choices within one conversation', () => {
    const { overlay, speaker, text } = overlayParts();

    overlay.showLine('Alice', 'Pick one');
    overlay.showChoices(['Yes', 'No'], 0);

    expect(speaker?.textContent).toBe('Alice');
    expect(text?.textContent).toBe('Pick one');
  });

  it('clears displayed choices when the next dialogue line appears', () => {
    const { overlay, choices } = overlayParts();

    overlay.showChoices(['Yes', 'No'], 0);
    overlay.showLine('Alice', 'Next line');

    expect(choices?.children).toHaveLength(0);
  });

  it('marks exactly the highlighted choice as current for assistive technology', () => {
    const { overlay, choices } = overlayParts();
    const current = () => choices?.children.map((row) => row.getAttribute('aria-current'));

    overlay.showChoices(['Yes', 'No'], 0);
    expect(current()).toEqual(['true', 'false']);

    overlay.setHighlightedIndex(1);
    expect(current()).toEqual(['false', 'true']);

    overlay.showChoices(['A', 'B', 'C'], 2);
    expect(current()).toEqual(['false', 'false', 'true']);
  });

  it('announces errors assertively and restores polite announcements when dialogue resumes or hides', () => {
    const { overlay } = overlayParts();
    const element = overlay.element as unknown as FakeElement;
    const role = () => element.getAttribute('role');

    overlay.showError('Could not save.');
    expect(role()).toBe('alert');
    expect(element.getAttribute('aria-live')).toBe('assertive');

    overlay.showLine('Alice', 'Back to talking');
    expect(role()).toBeNull();
    expect(element.getAttribute('aria-live')).toBe('polite');

    overlay.showError('Could not load.');
    overlay.hide();
    expect(role()).toBeNull();
    expect(element.getAttribute('aria-live')).toBe('polite');
  });
});
