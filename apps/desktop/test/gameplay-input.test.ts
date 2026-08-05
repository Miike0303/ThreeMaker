import { Actions } from '@threemaker/input';
import { describe, expect, it } from 'vitest';
import { resolveGameplayAction, resolveGameplayKeyAction } from '../src/gameplay-input.js';

describe('resolveGameplayAction', () => {
  it('maps interact to try-interact only while idle', () => {
    expect(resolveGameplayAction(Actions.Interact, 'idle')).toEqual({ kind: 'try-interact' });
    expect(resolveGameplayAction(Actions.Interact, 'running')).toBeUndefined();
    expect(resolveGameplayAction(Actions.MoveUp, 'idle')).toBeUndefined();
  });

  it('maps interact to advance/confirm during dialogue wait states', () => {
    expect(resolveGameplayAction(Actions.Interact, 'waiting-for-dialogue')).toEqual({
      kind: 'advance',
    });
    expect(resolveGameplayAction(Actions.Interact, 'waiting-for-choice')).toEqual({
      kind: 'confirmHighlighted',
    });
  });

  it('maps move.* to choice navigation while waiting for a choice', () => {
    expect(resolveGameplayAction(Actions.MoveUp, 'waiting-for-choice')).toEqual({
      kind: 'navigate',
      delta: -1,
    });
    expect(resolveGameplayAction(Actions.MoveDown, 'waiting-for-choice')).toEqual({
      kind: 'navigate',
      delta: 1,
    });
    expect(resolveGameplayAction(Actions.MoveLeft, 'waiting-for-choice')).toEqual({
      kind: 'navigate',
      delta: -1,
    });
    expect(resolveGameplayAction(Actions.MoveRight, 'waiting-for-choice')).toEqual({
      kind: 'navigate',
      delta: 1,
    });
    expect(resolveGameplayAction(Actions.MoveUp, 'waiting-for-dialogue')).toBeUndefined();
  });
});

describe('resolveGameplayKeyAction', () => {
  it('maps E (any casing) to try-interact only while the interpreter is idle', () => {
    expect(resolveGameplayKeyAction('e', 'idle')).toEqual({ kind: 'try-interact' });
    expect(resolveGameplayKeyAction('E', 'idle')).toEqual({ kind: 'try-interact' });
    expect(resolveGameplayKeyAction('e', 'running')).toBeUndefined();
    expect(resolveGameplayKeyAction('e', 'waiting-for-dialogue')).toEqual({ kind: 'advance' });
    expect(resolveGameplayKeyAction('e', 'waiting-for-choice')).toEqual({
      kind: 'confirmHighlighted',
    });
  });

  it('does not treat Enter/Space as interact while idle (only E faces NPCs/triggers)', () => {
    expect(resolveGameplayKeyAction('Enter', 'idle')).toBeUndefined();
    expect(resolveGameplayKeyAction(' ', 'idle')).toBeUndefined();
  });

  it('routes dialogue advance keys while waiting for a line', () => {
    expect(resolveGameplayKeyAction('Enter', 'waiting-for-dialogue')).toEqual({ kind: 'advance' });
    expect(resolveGameplayKeyAction(' ', 'waiting-for-dialogue')).toEqual({ kind: 'advance' });
  });

  it('routes choice navigation and digits while waiting for a choice', () => {
    expect(resolveGameplayKeyAction('ArrowUp', 'waiting-for-choice')).toEqual({
      kind: 'navigate',
      delta: -1,
    });
    expect(resolveGameplayKeyAction('1', 'waiting-for-choice')).toEqual({
      kind: 'chooseIndex',
      index: 0,
    });
    expect(resolveGameplayKeyAction('ArrowUp', 'waiting-for-dialogue')).toBeUndefined();
    expect(resolveGameplayKeyAction('1', 'waiting-for-dialogue')).toBeUndefined();
  });

  it('ignores keys while a script is running (moveEntity / host busy)', () => {
    expect(resolveGameplayKeyAction('e', 'running')).toBeUndefined();
    expect(resolveGameplayKeyAction('Enter', 'running')).toBeUndefined();
    expect(resolveGameplayKeyAction('1', 'running')).toBeUndefined();
  });

  it('returns undefined for unmapped keys in every state', () => {
    expect(resolveGameplayKeyAction('q', 'idle')).toBeUndefined();
    expect(resolveGameplayKeyAction('g', 'waiting-for-dialogue')).toBeUndefined();
    expect(resolveGameplayKeyAction('p', 'waiting-for-choice')).toBeUndefined();
  });
});
