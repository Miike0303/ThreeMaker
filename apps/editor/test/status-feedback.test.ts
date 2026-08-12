import { describe, expect, it } from 'vitest';
import {
  initialStatusFeedback,
  transitionStatusFeedback,
} from '../src/status-feedback.js';

describe('status feedback transitions', () => {
  it('replaces and resets a toast when an identical message is reported again', () => {
    const first = transitionStatusFeedback(initialStatusFeedback, {
      type: 'report',
      report: { message: 'Saved', severity: 'success' },
    });
    const repeated = transitionStatusFeedback(first, {
      type: 'report',
      report: { message: 'Saved', severity: 'success' },
    });

    expect(repeated.message).toBe('Saved');
    expect(repeated.toast).toEqual({ id: 2, message: 'Saved', severity: 'success' });
    expect(
      transitionStatusFeedback(repeated, {
        type: 'dismiss-toast',
        id: first.toast?.id ?? -1,
      }),
    ).toBe(repeated);
  });

  it('dismisses only the matching toast and preserves the footer message', () => {
    const reported = transitionStatusFeedback(initialStatusFeedback, {
      type: 'report',
      report: { message: 'Check this', severity: 'warning' },
    });
    const dismissed = transitionStatusFeedback(reported, {
      type: 'dismiss-toast',
      id: reported.toast?.id ?? -1,
    });

    expect(dismissed.message).toBe('Check this');
    expect(dismissed.toast).toBeNull();
  });

  it('ignores stale dismissals after a newer report', () => {
    const first = transitionStatusFeedback(initialStatusFeedback, {
      type: 'report',
      report: { message: 'First', severity: 'info' },
    });
    const second = transitionStatusFeedback(first, {
      type: 'report',
      report: { message: 'Second', severity: 'error' },
    });
    const staleDismiss = transitionStatusFeedback(second, {
      type: 'dismiss-toast',
      id: first.toast?.id ?? -1,
    });

    expect(staleDismiss).toBe(second);
  });

  it('clears both the footer message and toast without reusing IDs', () => {
    const first = transitionStatusFeedback(initialStatusFeedback, {
      type: 'report',
      report: { message: 'First', severity: 'info' },
    });
    const cleared = transitionStatusFeedback(first, { type: 'clear' });
    const afterClear = transitionStatusFeedback(cleared, {
      type: 'report',
      report: { message: 'After clear', severity: 'info' },
    });

    expect(cleared.message).toBeNull();
    expect(cleared.toast).toBeNull();
    expect(afterClear.toast?.id).toBe(2);
  });
});
