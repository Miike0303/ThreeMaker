/**
 * Pure helpers for the events editor forms (WU-02) + save hard-gate.
 */
import { describe, expect, it } from 'vitest';
import {
  canSavePainterDocument,
  defaultWorldSeedValue,
  dialogueLinesFromTextarea,
  dialogueLinesToTextarea,
  EVENT_COMMAND_KINDS,
  parseIntField,
  parseNumberField,
  parseWorldValue,
  type WorldValueKind,
  worldValueKind,
} from '../src/event-form-helpers.js';

describe('event-form-helpers: WorldValue parsing', () => {
  it('worldValueKind mirrors typeof for boolean/number/string', () => {
    expect(worldValueKind(true)).toBe('boolean');
    expect(worldValueKind(false)).toBe('boolean');
    expect(worldValueKind(0)).toBe('number');
    expect(worldValueKind(3.5)).toBe('number');
    expect(worldValueKind('hi')).toBe('string');
  });

  it('parseWorldValue coerces by kind with safe fallbacks', () => {
    expect(parseWorldValue('boolean', true)).toBe(true);
    expect(parseWorldValue('boolean', false)).toBe(false);
    expect(parseWorldValue('boolean', 'true')).toBe(true);
    expect(parseWorldValue('boolean', 'false')).toBe(false);
    expect(parseWorldValue('boolean', 'nope')).toBe(false);

    expect(parseWorldValue('number', '42')).toBe(42);
    expect(parseWorldValue('number', '3.14')).toBe(3.14);
    expect(parseWorldValue('number', '')).toBe(0);
    expect(parseWorldValue('number', 'nan')).toBe(0);
    expect(parseWorldValue('number', 7)).toBe(7);

    expect(parseWorldValue('string', 'hello')).toBe('hello');
    expect(parseWorldValue('string', '')).toBe('');
    expect(parseWorldValue('string', true)).toBe('true');
    expect(parseWorldValue('string', 9)).toBe('9');
  });

  it('defaultWorldSeedValue returns a typed zero-ish seed per kind', () => {
    const kinds: readonly WorldValueKind[] = ['boolean', 'number', 'string'];
    expect(kinds.map(defaultWorldSeedValue)).toEqual([false, 0, '']);
  });
});

describe('event-form-helpers: numeric field parsing', () => {
  it('parseIntField parses integers and falls back on garbage', () => {
    expect(parseIntField('12', 0)).toBe(12);
    expect(parseIntField('-3', 0)).toBe(-3);
    expect(parseIntField('3.9', 0)).toBe(3);
    expect(parseIntField('', 5)).toBe(5);
    expect(parseIntField('x', 5)).toBe(5);
  });

  it('parseNumberField parses floats and falls back on garbage', () => {
    expect(parseNumberField('1.5', 0)).toBe(1.5);
    expect(parseNumberField('-2', 0)).toBe(-2);
    expect(parseNumberField('', 9)).toBe(9);
    expect(parseNumberField('nope', 9)).toBe(9);
  });
});

describe('event-form-helpers: dialogue lines', () => {
  it('round-trips textarea text ↔ lines (one line per row)', () => {
    expect(dialogueLinesFromTextarea('Hello\nWorld')).toEqual(['Hello', 'World']);
    expect(dialogueLinesFromTextarea('')).toEqual(['']);
    expect(dialogueLinesFromTextarea('solo')).toEqual(['solo']);
    expect(dialogueLinesToTextarea(['a', 'b'])).toBe('a\nb');
    expect(dialogueLinesToTextarea([])).toBe('');
  });
});

describe('event-form-helpers: command kinds', () => {
  it('lists all 8 event command kinds', () => {
    expect(EVENT_COMMAND_KINDS).toEqual([
      'moveEntity',
      'showDialogue',
      'conditional',
      'setWorldVar',
      'teleport',
      'transferMap',
      'giveItem',
      'modifyStat',
    ]);
  });
});

describe('canSavePainterDocument (save hard-gate seam)', () => {
  it('returns null when events draft is valid', () => {
    expect(
      canSavePainterDocument({
        events: { intro: [{ type: 'setWorldVar', key: 'flag', value: true }] },
      }),
    ).toBeNull();
  });

  it('returns validateEventsDraft error when draft is invalid (blocks save)', () => {
    // Default giveItem has empty itemId — same invalid shape the panel can produce.
    const err = canSavePainterDocument({
      events: { bad: [{ type: 'giveItem', itemId: '', amount: 1 }] },
    });
    expect(typeof err).toBe('string');
    expect(err).toMatch(/Invalid Event Script/);
  });
});
