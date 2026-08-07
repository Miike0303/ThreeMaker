/**
 * Locale key parity (loop-crear-jugar Slice 5b): the stair-link/spawn-point
 * authoring UI's new keys must exist with real, non-empty text in BOTH
 * locales -- a missing key would silently fall back to rendering the raw
 * key string to the user (`i18n.ts`'s `t()` fallback chain). Mirrors
 * apps/desktop/test/locales.test.ts's pattern (same shared `i18n.ts`).
 */
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json' with { type: 'json' };
import es from '../src/locales/es.json' with { type: 'json' };

const NEW_KEYS = [
  'painter.tool.stair-link',
  'painter.tool.spawn-point',
  'painter.tool.prop',
  'painter.tool.npc',
  'painter.tool.trigger',
  'painter.stairLinks',
  'painter.stairLink.summary',
  'painter.stairLink.bidirectional',
  'painter.stairLink.remove',
  'painter.stairLink.entryLabel',
  'painter.stairLink.exitLabel',
  'painter.stairLink.pendingHint',
  'painter.spawn',
  'painter.spawn.notSet',
  'painter.spawn.summary',
  'painter.spawn.clear',
  'painter.spawn.overlayLabel',
  'painter.props',
  'painter.props.pickGlb',
  'painter.props.currentObject',
  'painter.props.noObject',
  'painter.props.selectHint',
  'painter.props.summary',
  'painter.props.remove',
  'painter.props.overlayLabel',
  'painter.props.ingestSuccess',
  'painter.props.ingestFailed',
  'painter.props.ingestNeedsTauri',
  'painter.npcs',
  'painter.npcs.eventsHint',
  'painter.npcs.noEventsHint',
  'painter.npcs.noEvents',
  'painter.npcs.sprite',
  'painter.npcs.noSprite',
  'painter.npcs.selectSpriteHint',
  'painter.npcs.characterIndex',
  'painter.npcs.facing',
  'painter.npcs.facing.down',
  'painter.npcs.facing.left',
  'painter.npcs.facing.right',
  'painter.npcs.facing.up',
  'painter.npcs.event',
  'painter.npcs.summary',
  'painter.npcs.remove',
  'painter.npcs.overlayLabel',
  'painter.triggers',
  'painter.triggers.eventsHint',
  'painter.triggers.noEventsHint',
  'painter.triggers.noEvents',
  'painter.triggers.on',
  'painter.triggers.on.enter',
  'painter.triggers.on.interact',
  'painter.triggers.event',
  'painter.triggers.summary',
  'painter.triggers.remove',
  'painter.triggers.overlayLabel',
] as const;

describe('locale strings: stair-link + spawn-point authoring (Slice 5b)', () => {
  it.each(NEW_KEYS)('defines %s with real text in both en and es', (key) => {
    expect((en.strings as Record<string, string>)[key]).toBeTruthy();
    expect((es.strings as Record<string, string>)[key]).toBeTruthy();
    expect((en.strings as Record<string, string>)[key]).not.toBe(key);
    expect((es.strings as Record<string, string>)[key]).not.toBe(key);
  });

  it('keeps en and es in sync: identical key sets', () => {
    expect(Object.keys(es.strings).sort()).toEqual(Object.keys(en.strings).sort());
  });
});
