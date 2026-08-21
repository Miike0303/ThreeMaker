/**
 * Unsaved-changes tracking (WU-UX-13). Pure.
 *
 * The painter store is immutable: document mutations replace the affected
 * top-level slice, while tool/layer/brush/hover transitions keep every
 * document slice's reference intact. So a reference compare of exactly the
 * slices `currentDocument()` composes (plus `semantics`, which semantic-mode
 * strokes persist into the tileset) is an exact, allocation-free "did the
 * document change" signal between two emitted states.
 *
 * The map NAME lives on the doc, not in painter state — the panel marks
 * renames dirty at its own call site.
 */

import type { PainterState } from './painter-store.js';

export function painterDocumentSlicesChanged(prev: PainterState, next: PainterState): boolean {
  return (
    prev.floors !== next.floors ||
    prev.rooms !== next.rooms ||
    prev.stairLinks !== next.stairLinks ||
    prev.spawn !== next.spawn ||
    prev.props !== next.props ||
    prev.npcs !== next.npcs ||
    prev.triggers !== next.triggers ||
    prev.lights !== next.lights ||
    prev.events !== next.events ||
    prev.worldSeeds !== next.worldSeeds ||
    prev.semantics !== next.semantics
  );
}

/**
 * True when opening a map must confirm first: there is a map open and either
 * the map document or the Ink sidecar buffer has unsaved changes. Pure so
 * the rule is testable without rendering the panel -- this repo has no
 * testing-library, and asserting on component source text is brittle enough
 * that it would pass again the moment someone reformats it.
 */
export function shouldConfirmMapSwitch(input: {
  readonly mapReady: boolean;
  readonly docDirty: boolean;
  readonly inkDirty?: boolean;
}): boolean {
  return input.mapReady && (input.docDirty || input.inkDirty === true);
}
