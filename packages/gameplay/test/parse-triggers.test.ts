import { describe, expect, it } from 'vitest';
import { parseTriggers } from '../src/parse-triggers.js';

describe('parseTriggers', () => {
  it('parses a valid triggers file', () => {
    const result = parseTriggers({
      version: 1,
      triggers: [{ id: 'gate', x: 3, y: 4, on: 'enter', event: 'gate-open' }],
    });

    expect(result).toEqual({
      version: 1,
      triggers: [{ id: 'gate', x: 3, y: 4, on: 'enter', event: 'gate-open' }],
    });
  });

  it('parses an empty triggers array', () => {
    expect(parseTriggers({ version: 1, triggers: [] })).toEqual({ version: 1, triggers: [] });
  });

  it('throws when the root is not an object', () => {
    expect(() => parseTriggers(42)).toThrow(
      'Invalid Trigger JSON: expected an object, got number.',
    );
  });

  it('throws when "version" is not 1', () => {
    expect(() => parseTriggers({ version: 2, triggers: [] })).toThrow(
      'Invalid Trigger JSON: "version" must be 1, got 2.',
    );
  });

  it('throws when "triggers" is not an array', () => {
    expect(() => parseTriggers({ version: 1, triggers: 'nope' })).toThrow(
      'Invalid Trigger JSON: "triggers" must be an array.',
    );
  });

  it('throws when a trigger is missing "id"', () => {
    expect(() =>
      parseTriggers({ version: 1, triggers: [{ x: 3, y: 4, on: 'enter', event: 'e' }] }),
    ).toThrow('Invalid Trigger JSON: triggers[0] requires a string "id".');
  });

  it('throws when a trigger is missing "event"', () => {
    expect(() =>
      parseTriggers({ version: 1, triggers: [{ id: 'gate', x: 3, y: 4, on: 'enter' }] }),
    ).toThrow('Invalid Trigger JSON: triggers[0] requires a string "event".');
  });

  it('throws on non-integer "x"', () => {
    expect(() =>
      parseTriggers({
        version: 1,
        triggers: [{ id: 'gate', x: 3.2, y: 4, on: 'enter', event: 'e' }],
      }),
    ).toThrow('Invalid Trigger JSON: triggers[0] "x" must be an integer, got 3.2.');
  });

  it('throws on non-integer "y"', () => {
    expect(() =>
      parseTriggers({
        version: 1,
        triggers: [{ id: 'gate', x: 3, y: null, on: 'enter', event: 'e' }],
      }),
    ).toThrow('Invalid Trigger JSON: triggers[0] "y" must be an integer, got null.');
  });

  it('throws on an invalid "on" value', () => {
    expect(() =>
      parseTriggers({
        version: 1,
        triggers: [{ id: 'gate', x: 3, y: 4, on: 'leave', event: 'e' }],
      }),
    ).toThrow(
      'Invalid Trigger JSON: triggers[0] "on" must be one of enter, interact, got "leave".',
    );
  });
});
