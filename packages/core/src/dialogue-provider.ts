import type { DialogueSource } from './event-command.js';

/**
 * One step of a dialogue session, as produced by a {@link DialogueProvider}'s
 * `next()`. `line`/`choices` are consumed by the app's dialogue UI; `end`
 * signals the session is over and the owning event script may continue.
 */
export type DialogueStep =
  | { readonly kind: 'line'; readonly speaker?: string; readonly text: string }
  | { readonly kind: 'choices'; readonly options: readonly string[] }
  | { readonly kind: 'end' };

/**
 * Uniform contract over a dialogue backend (plain text, ink, or any other
 * source), so {@link EventInterpreter}'s `showDialogue` handling stays
 * agnostic to where the content comes from.
 */
export interface DialogueProvider {
  /** Begin a session for `source`, resetting any prior session's cursor. */
  open(source: DialogueSource): void;
  /** Advance to and return the next step (line, choices, or end). */
  next(): DialogueStep;
  /** Select choice `index` from the most recently emitted `choices` step. */
  choose(index: number): void;
}
