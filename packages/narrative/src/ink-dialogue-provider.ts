import type { DialogueProvider, DialogueSource, DialogueStep } from '@threemaker/core';
import type { Story } from 'inkjs';

/** Maps a `DialogueSource`'s `storyId` to its already-compiled, already-bound {@link Story}. */
export type InkStoryRegistry = ReadonlyMap<string, Story>;

/** Extracts a `# speaker: Name` tag's value from ink's `currentTags`, if present. */
function extractSpeaker(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    const colonIndex = tag.indexOf(':');
    if (colonIndex === -1) continue;
    const key = tag.slice(0, colonIndex).trim();
    if (key === 'speaker') {
      return tag.slice(colonIndex + 1).trim();
    }
  }
  return undefined;
}

/**
 * A {@link DialogueProvider} over `{ kind: 'ink' }` sources, backed by
 * pre-compiled inkjs {@link Story} instances. v1 scope: single-file stories
 * only, no tag vocabulary beyond `# speaker: Name`, no save/restore of story
 * state across sessions — re-opening the same `storyId` without a `knot`
 * continues wherever that Story last left off (ink's own statefulness), not
 * a fresh restart.
 */
export class InkDialogueProvider implements DialogueProvider {
  private readonly stories: InkStoryRegistry;
  private activeStory: Story | null = null;

  constructor(stories: InkStoryRegistry) {
    this.stories = stories;
  }

  /**
   * Begin a session against the story registered for `source.storyId`,
   * optionally jumping to `source.knot`. Throws if `source` isn't an `ink`
   * source, or if no story is registered for `storyId`.
   */
  open(source: DialogueSource): void {
    if (source.kind !== 'ink') {
      throw new Error(`InkDialogueProvider only supports "ink" sources, got "${source.kind}".`);
    }
    const story = this.stories.get(source.storyId);
    if (story === undefined) {
      throw new Error(`InkDialogueProvider: no story registered for storyId "${source.storyId}".`);
    }
    this.activeStory = story;
    if (source.knot !== undefined) {
      story.ChoosePathString(source.knot);
    }
  }

  /**
   * Advance the active story by one step: a `line` (with a `speaker` when a
   * `# speaker: Name` tag is present on it), a `choices` step when the story
   * has run out of continuable text and has pending choices, or `end`
   * otherwise.
   */
  next(): DialogueStep {
    const story = this.requireActiveStory('next()');

    if (story.canContinue) {
      const text = (story.Continue() ?? '').replace(/\r?\n$/, '');
      const speaker = extractSpeaker(story.currentTags ?? []);
      return speaker !== undefined ? { kind: 'line', speaker, text } : { kind: 'line', text };
    }

    if (story.currentChoices.length > 0) {
      return { kind: 'choices', options: story.currentChoices.map((choice) => choice.text) };
    }

    return { kind: 'end' };
  }

  /**
   * Select choice `index` from the most recently emitted `choices` step.
   * Throws a precise error if the story currently has no pending choices,
   * instead of delegating straight to inkjs's `ChooseChoiceIndex` (which
   * throws its own opaque "out of range" assertion).
   */
  choose(index: number): void {
    const story = this.requireActiveStory('choose()');
    if (story.currentChoices.length === 0) {
      throw new Error('InkDialogueProvider: choose() called with no pending choices.');
    }
    story.ChooseChoiceIndex(index);
  }

  private requireActiveStory(callerLabel: string): Story {
    if (this.activeStory === null) {
      throw new Error(`InkDialogueProvider: ${callerLabel} called before open().`);
    }
    return this.activeStory;
  }
}
