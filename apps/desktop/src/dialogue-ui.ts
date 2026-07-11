import type { I18n } from './i18n.js';

/**
 * One resolved keyboard input for the dialogue overlay. Pure mapping from a
 * raw `KeyboardEvent.key` string (plus whether choices are currently
 * pending) to an intent the caller (main.ts) applies to the
 * `EventInterpreter`/overlay -- this module never touches the DOM or the
 * interpreter directly.
 */
export type DialogueKeyAction =
  | { readonly kind: 'advance' }
  | { readonly kind: 'confirmHighlighted' }
  | { readonly kind: 'chooseIndex'; readonly index: number }
  | { readonly kind: 'navigate'; readonly delta: -1 | 1 };

// E/Enter/Space: "advance" per spec's dialogue-ui Keyboard interaction
// scenario when no choices are pending; the same physical keys become
// "confirm the highlighted choice" once choices are shown (digits/arrows
// pick directly, this key confirms whichever option is currently
// highlighted).
const ADVANCE_KEYS = new Set(['e', 'enter', ' ']);
const NAVIGATE_PREVIOUS_KEYS = new Set(['arrowup', 'arrowleft']);
const NAVIGATE_NEXT_KEYS = new Set(['arrowdown', 'arrowright']);

/** Zero-based choice index for digit keys '1'-'9' (one-based on the keyboard, matching the localized "1-9" hint). */
function digitChoiceIndex(key: string): number | undefined {
  if (key.length !== 1) return undefined;
  const digit = Number(key);
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return undefined;
  return digit - 1;
}

/**
 * Resolves a raw keyboard key into a dialogue action, or `undefined` when
 * the key isn't mapped in the current context. Digit and arrow keys only
 * resolve while `hasChoices` is true (per spec: "advance on advance-key with
 * no pending choices" -- choice-only keys are inert until choices exist).
 */
export function resolveDialogueKeyAction(
  key: string,
  hasChoices: boolean,
): DialogueKeyAction | undefined {
  const normalized = key.toLowerCase();

  if (ADVANCE_KEYS.has(normalized)) {
    return hasChoices ? { kind: 'confirmHighlighted' } : { kind: 'advance' };
  }

  if (!hasChoices) return undefined;

  const digitIndex = digitChoiceIndex(normalized);
  if (digitIndex !== undefined) return { kind: 'chooseIndex', index: digitIndex };

  if (NAVIGATE_PREVIOUS_KEYS.has(normalized)) return { kind: 'navigate', delta: -1 };
  if (NAVIGATE_NEXT_KEYS.has(normalized)) return { kind: 'navigate', delta: 1 };

  return undefined;
}

/**
 * Applies a navigation `delta` to `current`, wrapping around
 * `optionCount`'s bounds in both directions. Returns 0 defensively when
 * `optionCount` is 0 (no options to highlight).
 */
export function nextHighlightedIndex(current: number, delta: -1 | 1, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return (current + delta + optionCount) % optionCount;
}

/** Localized speaker label: the given speaker, or a localized fallback when a dialogue line carries no `# speaker:` tag. */
export function formatSpeakerLabel(speaker: string | undefined, t: I18n['t']): string {
  return speaker ?? t('dialogue.unknownSpeaker');
}

/** Localized keyboard-hint chrome, matching whichever key set is currently active (advance-only, or choice navigation/confirm). */
export function formatDialogueHint(hasChoices: boolean, t: I18n['t']): string {
  return hasChoices ? t('dialogue.hint.choice') : t('dialogue.hint.advance');
}

export interface DialogueOverlay {
  readonly element: HTMLElement;
  /** Shows a dialogue line (with localized speaker fallback) and the advance hint. Hides any previous choice list. */
  showLine(speaker: string | undefined, text: string): void;
  /** Shows a choices step: every option plus the choice hint, with `highlightedIndex` visually marked. */
  showChoices(options: readonly string[], highlightedIndex: number): void;
  /** Re-marks the highlighted choice without rebuilding the option list (call on arrow navigation). */
  setHighlightedIndex(index: number): void;
  /** Shows the localized ink/script-error chrome plus the raw error message (creator-facing, never crashes the app). */
  showError(message: string): void;
  /** Hides the overlay (dialogue session closed). */
  hide(): void;
}

/**
 * Builds the dialogue overlay: speaker + line/choices + a localized
 * keyboard-hint footer. DOM construction, not unit-tested here (this repo's
 * vitest config runs under `environment: 'node'`, no `document`) -- the pure
 * key-mapping/formatting helpers above carry the tested logic; this
 * function is thin wiring over them, the same split `debug-panel.ts` uses
 * for its own DOM-building.
 */
export function createDialogueOverlay(t: I18n['t']): DialogueOverlay {
  const overlay = document.createElement('div');
  overlay.className = 'dialogue-overlay';
  overlay.style.display = 'none';

  const speakerEl = document.createElement('div');
  speakerEl.className = 'dialogue-speaker';

  const textEl = document.createElement('div');
  textEl.className = 'dialogue-text';

  const choicesEl = document.createElement('ul');
  choicesEl.className = 'dialogue-choices';

  const hintEl = document.createElement('div');
  hintEl.className = 'dialogue-hint';

  overlay.append(speakerEl, textEl, choicesEl, hintEl);

  function renderChoiceRows(options: readonly string[], highlightedIndex: number): void {
    choicesEl.replaceChildren(
      ...options.map((option, index) => {
        const li = document.createElement('li');
        li.className = 'dialogue-choice';
        li.classList.toggle('dialogue-choice-highlighted', index === highlightedIndex);
        li.textContent = `${index + 1}. ${option}`;
        return li;
      }),
    );
  }

  return {
    element: overlay,
    showLine(speaker, text) {
      overlay.style.display = '';
      overlay.classList.remove('dialogue-overlay-error');
      speakerEl.textContent = formatSpeakerLabel(speaker, t);
      textEl.textContent = text;
      choicesEl.replaceChildren();
      hintEl.textContent = formatDialogueHint(false, t);
    },
    showChoices(options, highlightedIndex) {
      overlay.style.display = '';
      overlay.classList.remove('dialogue-overlay-error');
      renderChoiceRows(options, highlightedIndex);
      hintEl.textContent = formatDialogueHint(true, t);
    },
    setHighlightedIndex(index) {
      Array.from(choicesEl.children).forEach((child, childIndex) => {
        child.classList.toggle('dialogue-choice-highlighted', childIndex === index);
      });
    },
    showError(message) {
      overlay.style.display = '';
      overlay.classList.add('dialogue-overlay-error');
      speakerEl.textContent = '';
      textEl.textContent = `${t('dialogue.error')}: ${message}`;
      choicesEl.replaceChildren();
      hintEl.textContent = formatDialogueHint(false, t);
    },
    hide() {
      overlay.style.display = 'none';
    },
  };
}
