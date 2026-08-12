export type StatusSeverity = 'info' | 'success' | 'warning' | 'error';

export interface StatusReport {
  readonly message: string;
  readonly severity: StatusSeverity;
}

export interface StatusToast extends StatusReport {
  readonly id: number;
}

export interface StatusFeedback {
  readonly message: string | null;
  readonly toast: StatusToast | null;
  readonly nextToastId: number;
}

export type StatusFeedbackAction =
  | { readonly type: 'report'; readonly report: StatusReport }
  | { readonly type: 'dismiss-toast'; readonly id: number }
  | { readonly type: 'clear' };

export const initialStatusFeedback: StatusFeedback = {
  message: null,
  toast: null,
  nextToastId: 1,
};

export function transitionStatusFeedback(
  state: StatusFeedback,
  action: StatusFeedbackAction,
): StatusFeedback {
  if (action.type === 'report') {
    return {
      message: action.report.message,
      toast: { id: state.nextToastId, ...action.report },
      nextToastId: state.nextToastId + 1,
    };
  }

  if (action.type === 'dismiss-toast') {
    return state.toast?.id === action.id ? { ...state, toast: null } : state;
  }

  return { ...state, message: null, toast: null };
}
