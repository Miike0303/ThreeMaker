import {
  Actions,
  createBindingTable,
  defaultKeyboardBindings,
  rebindKeyboard,
} from '@threemaker/input';
import { describe, expect, it } from 'vitest';
import { resolveGameplayKeyAction } from '../src/gameplay-input.js';

describe('resolveGameplayKeyAction with injected remapped table', () => {
  it('uses the remapped interact key and ignores the old default', () => {
    const table = rebindKeyboard(
      createBindingTable(defaultKeyboardBindings()),
      Actions.Interact,
      'f',
    );
    expect(resolveGameplayKeyAction('f', 'idle', table)).toEqual({ kind: 'try-interact' });
    expect(resolveGameplayKeyAction('e', 'idle', table)).toBeUndefined();
  });
});
