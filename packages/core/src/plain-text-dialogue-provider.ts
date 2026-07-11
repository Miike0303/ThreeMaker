import type { DialogueProvider, DialogueStep } from './dialogue-provider.js';
import type { DialogueSource } from './event-command.js';

/**
 * A {@link DialogueProvider} over `{ kind: 'text' }` sources: steps through
 * `lines` in order, then reports `end` forever after. Never presents
 * choices — plain text has none in v1.
 */
export class PlainTextDialogueProvider implements DialogueProvider {
  private lines: readonly string[] | null = null;
  private cursor = 0;

  /** Begin stepping through `source.lines`. Throws if `source` isn't a text source. */
  open(source: DialogueSource): void {
    if (source.kind !== 'text') {
      throw new Error(
        `PlainTextDialogueProvider only supports "text" sources, got "${source.kind}".`,
      );
    }
    this.lines = source.lines;
    this.cursor = 0;
  }

  /** Returns the next line, or `end` once every line has been returned. */
  next(): DialogueStep {
    if (this.lines === null) {
      throw new Error('PlainTextDialogueProvider: next() called before open().');
    }
    const text = this.lines[this.cursor];
    if (text === undefined) {
      return { kind: 'end' };
    }
    this.cursor += 1;
    return { kind: 'line', text };
  }

  /** Always throws — plain text never emits a `choices` step to select from. */
  choose(): never {
    throw new Error(
      'PlainTextDialogueProvider: choose() is not supported — plain text has no choices.',
    );
  }
}
