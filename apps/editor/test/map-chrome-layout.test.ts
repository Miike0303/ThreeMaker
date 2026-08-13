/**
 * WU-C: map workspace chrome must fit its box — wrap/shrink on purpose,
 * never clip mid-word. Guards the layout contracts the live CDP probe checks.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json' with { type: 'json' };
import es from '../src/locales/es.json' with { type: 'json' };

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = readFileSync(join(SRC, 'editor.css'), 'utf8');
const viewportSrc = readFileSync(join(SRC, 'painter-viewport.ts'), 'utf8');
const painterSrc = readFileSync(join(SRC, 'components', 'PainterPanel.tsx'), 'utf8');

function ruleBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('map workspace chrome layout (WU-C)', () => {
  it('wraps inspector tabs so labels are not clipped', () => {
    const block = ruleBlock('.ide-inspector-tabs');
    expect(block).toContain('flex-wrap: wrap');
    expect(block).not.toContain('overflow-x: auto');
  });

  it('wraps the menubar instead of clipping Save/Load/Generate', () => {
    const block = ruleBlock('.ide-menubar');
    expect(block).toContain('flex-wrap: wrap');
    expect(block).not.toContain('nowrap');
    expect(block).not.toContain('overflow-x: auto');
  });

  it('lets the palette role hint wrap in flow, not as a clipped 1px box', () => {
    const block = ruleBlock('.ide-palette-role-hint');
    expect(block).toContain('white-space: normal');
    expect(block).not.toContain('clip:');
    expect(block).not.toContain('overflow: hidden');
  });

  it('lets the status bar grow instead of slicing context text', () => {
    const block = ruleBlock('.ide-status');
    expect(block).toContain('flex-wrap: wrap');
    expect(block).toContain('height: auto');
  });

  it('keeps the painter canvas inside the stage box', () => {
    expect(ruleBlock('.ide-viewport-stage')).toContain('overflow: hidden');
    expect(ruleBlock('.painter-viewport-canvas')).toContain('overflow: hidden');
    expect(ruleBlock('.painter-viewport-canvas canvas')).toContain('position: absolute');
  });

  it('sizes the WebGL canvas from the container, including palette-dock layout', () => {
    expect(viewportSrc).toContain('ResizeObserver');
    expect(viewportSrc).toContain('width < 1 || height < 1');
    expect(viewportSrc).toContain('setSize(width, height, false)');
  });

  it('does not use <legend> for rail group labels (legend min-content overflows the rail)', () => {
    expect(painterSrc).not.toMatch(/<legend className="ide-tool-group-label"/);
    expect(painterSrc).toContain('className="ide-tool-group"');
    expect(painterSrc).toContain('className="ide-tool-group-label"');
  });

  it('names rail groups after their actual tool sets, not shorter synonyms', () => {
    expect(en.strings['painter.toolGroup.paint']).toBe('Paint');
    expect(en.strings['painter.toolGroup.structure']).toBe('Structure');
    expect(en.strings['painter.toolGroup.entities']).toBe('Entities');
    expect(es.strings['painter.toolGroup.paint']).toBe('Pintar');
    expect(es.strings['painter.toolGroup.structure']).toBe('Estructura');
    expect(es.strings['painter.toolGroup.entities']).toBe('Entidades');
  });

  it('fits rail labels by shrinking inside the rail, not by breaking mid-word', () => {
    const block = ruleBlock('.ide-tool-group-label');
    expect(block).not.toContain('overflow-wrap: anywhere');
    expect(block).not.toContain('word-break: break-word');
    expect(block).not.toContain('word-break: break-all');
    expect(block).toContain('max-width: 100%');
  });
});
