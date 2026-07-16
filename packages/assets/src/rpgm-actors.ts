// Best-effort reader for RPG Maker MV/MZ's `Actors.json`, used by the batch
// `convert-rpgm-game` CLI command (rpgm-whole-game-import change) to pick a
// player-sprite character sheet for the whole game: the first playable
// actor's own `characterName`/`characterIndex` reference, the same fields
// RPG Maker itself uses to draw that actor's on-map sprite.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RpgmLeadActorSheet {
  /** Character-sheet image file name (without extension), e.g. `"Actor1"` -- resolves to `img/characters/<characterName>.png`. */
  readonly characterName: string;
  /** Which of the sheet's 8 character blocks (4 cols x 2 rows) this actor uses, 0-indexed. */
  readonly characterIndex: number;
}

/** Strips a leading UTF-8 BOM (U+FEFF), same convention as `rpgm-system.ts`'s `stripBom` (see commit beee919). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Reads `Actors.json`'s first defined actor entry (RPGM's 1-indexed sparse
 * array -- index 0 is always `null`) and returns its character-sheet
 * reference. Fail-soft: returns `undefined` for a missing/malformed file, an
 * actor with no `characterName` (empty string), or a `$`-prefixed name (a
 * single-character sheet with a different 3x4 frame grid than the standard
 * 4-cols-x-2-rows actor sheet this change's player-sprite slicing assumes --
 * out of scope, matches the "else keep the placeholder" fail-soft
 * convention rather than misrendering a wrongly-sliced sheet).
 */
export function readLeadActorSheet(gameDir: string): RpgmLeadActorSheet | undefined {
  const candidates = [gameDir, join(gameDir, 'data'), join(gameDir, 'www', 'data')];
  for (const dir of candidates) {
    const actorsPath = join(dir, 'Actors.json');
    if (!existsSync(actorsPath)) continue;
    try {
      const actors = JSON.parse(stripBom(readFileSync(actorsPath, 'utf8'))) as unknown;
      if (!Array.isArray(actors)) return undefined;
      const first = actors.find((entry) => entry !== null && typeof entry === 'object');
      if (!first) return undefined;
      const { characterName, characterIndex } = first as {
        readonly characterName?: unknown;
        readonly characterIndex?: unknown;
      };
      if (typeof characterName !== 'string' || characterName.length === 0) return undefined;
      if (typeof characterIndex !== 'number') return undefined;
      if (characterName.startsWith('$')) return undefined;
      return { characterName, characterIndex };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
