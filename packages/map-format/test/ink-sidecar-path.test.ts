/**
 * Path + charset gate for Ink sidecars next to a `.tmmap.json` map.
 */
import { describe, expect, it } from 'vitest';
import {
  inkSidecarRelativePath,
  isSafeStoryId,
  MAP_DOCUMENT_FILE_SUFFIX,
} from '../src/ink-sidecar-path.js';

it('rejects plus signs in story ids before deriving a sidecar path', () => {
  expect(isSafeStoryId('act+2')).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'act+2')).toThrow(/story id/i);
});

describe('isSafeStoryId / inkSidecarRelativePath', () => {
  it('rejects Unicode connector punctuation before deriving a sidecar path', () => {
    for (const connector of ['\u203f', '\uff3f']) {
      const storyId = `chapter${connector}2`;

      expect(isSafeStoryId(storyId)).toBe(false);
      expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
    }
  });

  it('rejects emoji in story ids before deriving a sidecar path', () => {
    const storyId = 'chapter\u{1f4d6}2';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects typographic dashes before deriving a sidecar path', () => {
    for (const dash of ['\u2013', '\u2014']) {
      const storyId = `chapter${dash}2`;

      expect(isSafeStoryId(storyId)).toBe(false);
      expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
    }
  });

  it('rejects decomposed Unicode combining marks before deriving a sidecar path', () => {
    const storyId = 'cafe\u0301';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects invisible Unicode format controls before deriving a sidecar path', () => {
    for (const control of ['\u200b', '\u202e', '\ufeff']) {
      const storyId = `chapter${control}2`;

      expect(isSafeStoryId(storyId)).toBe(false);
      expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
    }
  });

  it('rejects Unicode case-folding lookalikes before deriving a sidecar path', () => {
    for (const storyId of ['chapter\u212A2', 'chapter\u017F2']) {
      expect(isSafeStoryId(storyId)).toBe(false);
      expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
    }
  });

  it('explains the allowed characters when rejecting an unsafe story id', () => {
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'act/intro')).toThrow(
      'is not path-safe (letters, digits, "_" and "-" only).',
    );
  });

  it('rejects tabs in story ids before deriving a sidecar path', () => {
    const storyId = 'chapter\t2';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects NUL bytes in story ids before deriving a sidecar path', () => {
    const storyId = 'chapter\u00002';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects greater-than signs in story ids before deriving a sidecar path', () => {
    const storyId = 'chapter>2';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects question marks in story ids before deriving a sidecar path', () => {
    const storyId = 'chapter?2';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('accepts story ids that start with a digit, underscore, or hyphen', () => {
    for (const storyId of ['7_intro', '_intro', '-intro']) {
      expect(isSafeStoryId(storyId)).toBe(true);
      expect(inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toBe(
        `maps/town.${storyId}.ink`,
      );
    }
  });

  it('accepts a UUID-length story id when deriving a sidecar path', () => {
    const storyId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    expect(isSafeStoryId(storyId)).toBe(true);
    expect(inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toBe(
      'maps/town.f47ac10b-58cc-4372-a567-0e02b2c3d479.ink',
    );
  });

  it('rejects at signs in story ids before deriving a sidecar path', () => {
    expect(isSafeStoryId('chapter@2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter@2')).toThrow(/story id/i);
  });

  it('rejects opening brackets in story ids before deriving a sidecar path', () => {
    expect(isSafeStoryId('chapter[2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter[2')).toThrow(/story id/i);
  });

  it('rejects backticks in story ids before deriving a sidecar path', () => {
    expect(isSafeStoryId('chapter`2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter`2')).toThrow(/story id/i);
  });

  it('rejects opening braces in story ids before deriving a sidecar path', () => {
    expect(isSafeStoryId('chapter{2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter{2')).toThrow(/story id/i);
  });

  it('accepts uppercase letters inside the story-id range', () => {
    expect(isSafeStoryId('chapterM2')).toBe(true);
    expect(inkSidecarRelativePath('maps/town.tmmap.json', 'chapterM2')).toBe(
      'maps/town.chapterM2.ink',
    );
  });

  it('rejects non-ASCII letters in story ids before deriving a sidecar path', () => {
    const storyId = 'caf\u00e9';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('accepts a one-character story id when deriving a sidecar path', () => {
    expect(isSafeStoryId('x')).toBe(true);
    expect(inkSidecarRelativePath('maps/town.tmmap.json', 'x')).toBe('maps/town.x.ink');
  });

  it('identifies the unsafe story id in the sidecar-path error', () => {
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'act/intro')).toThrow(
      'Ink story id "act/intro" is not path-safe',
    );
  });

  it('rejects a story id containing a line break before deriving its sidecar path', () => {
    const storyId = 'intro\nsecret';

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  });

  it('rejects tilde in a story id before deriving its sidecar path', () => {
    expect(isSafeStoryId('chapter~2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter~2')).toThrow(/story id/i);
  });

  it('rejects a colon in a story id before deriving its sidecar path', () => {
    expect(isSafeStoryId('chapter:2')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'chapter:2')).toThrow(/story id/i);
  });

  it('accepts Z at the upper edge of the uppercase story-id range', () => {
    expect(isSafeStoryId('chapterZ')).toBe(true);
  });

  it('accepts z at the upper edge of the lowercase story-id range', () => {
    expect(isSafeStoryId('chapterz')).toBe(true);
  });

  it('keeps a suffix embedded in the map path instead of stripping its tail', () => {
    expect(inkSidecarRelativePath('maps/town.tmmap.json.backup', 'intro')).toBe(
      'maps/town.tmmap.json.backup.intro.ink',
    );
  });

  it('accepts only path-safe story ids', () => {
    expect(isSafeStoryId('elder')).toBe(true);
    expect(isSafeStoryId('gate_01')).toBe(true);
    expect(isSafeStoryId('A-b')).toBe(true);
    expect(isSafeStoryId('')).toBe(false);
    expect(isSafeStoryId('../evil')).toBe(false);
    expect(isSafeStoryId('act/intro')).toBe(false);
    expect(isSafeStoryId('has.dot')).toBe(false);
    expect(isSafeStoryId('has space')).toBe(false);
  });

  it('accepts 9 at the upper edge of the story-id digit range', () => {
    expect(isSafeStoryId('chapter9')).toBe(true);
  });

  it('rejects a Windows path separator between upper and lower ASCII letters', () => {
    expect(isSafeStoryId('bad\\name')).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'bad\\name')).toThrow(/story id/i);
  });

  it('derives <mapBase>.<storyId>.ink beside a .tmmap.json map', () => {
    expect(MAP_DOCUMENT_FILE_SUFFIX).toBe('.tmmap.json');
    expect(inkSidecarRelativePath('.threemaker/maps/current.tmmap.json', 'elder')).toBe(
      '.threemaker/maps/current.elder.ink',
    );
    expect(inkSidecarRelativePath('maps/map-a.tmmap.json', 'guard')).toBe('maps/map-a.guard.ink');
    expect(inkSidecarRelativePath('current.tmmap.json', 'intro')).toBe('current.intro.ink');
    expect(inkSidecarRelativePath('maps/town', 'intro')).toBe('maps/town.intro.ink');
  });

  it('throws on unsafe story ids before path join', () => {
    expect(() => inkSidecarRelativePath('m.tmmap.json', '../x')).toThrow(/story id/i);
    expect(() => inkSidecarRelativePath('m.tmmap.json', 'act/intro')).toThrow(/story id/i);
  });
});

it('rejects dollar signs in story ids before deriving a sidecar path', () => {
  expect(isSafeStoryId('act$2')).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', 'act$2')).toThrow(/story id/i);
});

it('rejects wildcard story ids before deriving a sidecar path', () => {
  const storyId = 'chapter*2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects percent-encoded separators in story ids before deriving a sidecar path', () => {
  const storyId = 'act%2Fintro';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects vertical bars in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter|2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects double quotes in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter"2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects hash signs in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter#2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects less-than signs in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter<2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('accepts a 65-character story id without truncating its sidecar path', () => {
  const storyId = 'a'.repeat(65);

  expect(isSafeStoryId(storyId)).toBe(true);
  expect(inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toBe(`maps/town.${storyId}.ink`);
});

it('rejects trailing whitespace before deriving a sidecar path', () => {
  for (const whitespace of [' ', '\t', '\n', '\r\n']) {
    const storyId = `intro${whitespace}`;

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  }
});

it('rejects ampersands in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter&2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects semicolons in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter;2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects equals signs in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter=2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects exclamation marks in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter!2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects commas in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter,2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects apostrophes in story ids before deriving a sidecar path', () => {
  const storyId = "chapter'2";

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects parentheses in story ids before deriving a sidecar path', () => {
  const storyId = 'chapter(2)';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects an opening parenthesis alone before deriving a sidecar path', () => {
  const storyId = 'chapter(2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects a closing parenthesis alone before deriving a sidecar path', () => {
  const storyId = 'chapter)2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects closing square brackets before deriving a sidecar path', () => {
  const storyId = 'chapter]2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects closing braces before deriving a sidecar path', () => {
  const storyId = 'chapter}2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects carets before deriving a sidecar path', () => {
  const storyId = 'chapter^2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects an embedded carriage return before deriving a sidecar path', () => {
  const storyId = 'chapter\r2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects non-ASCII decimal digits before deriving a sidecar path', () => {
  const storyId = 'chapter\u0662';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects a Unicode line separator before deriving a sidecar path', () => {
  const storyId = 'chapter\u20282';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects ASCII control whitespace before deriving a sidecar path', () => {
  for (const whitespace of ['\v', '\f']) {
    const storyId = `chapter${whitespace}2`;

    expect(isSafeStoryId(storyId)).toBe(false);
    expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
  }
});

it('rejects a Unicode paragraph separator before deriving a sidecar path', () => {
  const storyId = 'chapter\u20292';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});

it('rejects a backspace character before deriving a sidecar path', () => {
  const storyId = 'chapter\b2';

  expect(isSafeStoryId(storyId)).toBe(false);
  expect(() => inkSidecarRelativePath('maps/town.tmmap.json', storyId)).toThrow(/story id/i);
});
