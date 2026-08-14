import type { InkStoryRegistry } from './ink-dialogue-provider.js';

export type RestoreInkStoryStatesResult = {
  readonly restored: string[];
  readonly skipped: string[];
};

/**
 * Snapshot every registered story's inkjs state (`story.state.ToJson()`),
 * keyed by `storyId`. The host persists this record; it does not restore an
 * open dialogue UI.
 */
export function captureInkStoryStates(stories: InkStoryRegistry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [storyId, story] of stories) {
    out[storyId] = story.state.ToJson();
  }
  return out;
}

/**
 * Load saved ink state into matching registered stories (`LoadJson`).
 *
 * An id present in the save but not in the registry is skipped (the map no
 * longer ships that story — data drift, not a crash). A `LoadJson` that
 * throws on malformed JSON is also skipped so one bad story cannot abort
 * the rest of the load. Returns the restored/skipped split so the host can
 * log honestly.
 */
export function restoreInkStoryStates(
  stories: InkStoryRegistry,
  saved: Readonly<Record<string, string>>,
): RestoreInkStoryStatesResult {
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const [storyId, json] of Object.entries(saved)) {
    const story = stories.get(storyId);
    if (story === undefined) {
      skipped.push(storyId);
      continue;
    }
    try {
      story.state.LoadJson(json);
      restored.push(storyId);
    } catch {
      skipped.push(storyId);
    }
  }
  return { restored, skipped };
}
