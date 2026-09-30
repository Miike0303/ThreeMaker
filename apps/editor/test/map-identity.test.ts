/**
 * Named-map identity: filename validation, path derivation, list/rename/delete
 * plans, and legacy `current.tmmap.json` adoption (WU-B).
 */
import { describe, expect, it } from 'vitest';
import {
  assertMapName,
  collidingSavedMapName,
  existingMapDocumentFileName,
  foldMapFileName,
  INK_FILE_SUFFIX,
  InvalidMapNameError,
  isInkSidecarForMap,
  LEGACY_MAP_NAME,
  listInkStoryIdsFromEntries,
  listMapNamesFromEntries,
  MAP_DIR_RELATIVE,
  MAP_FILE_SUFFIX,
  MAP_NAME_MAX_LENGTH,
  mapDocumentFileName,
  mapFileNamesEqual,
  mapFileRelativePath,
  mapNameFromDocumentFileName,
  planDeleteMapFiles,
  planRenameMapFiles,
  shouldConfirmPlaytestDualWrite,
  validateMapName,
} from '../src/map-identity.js';

describe('validateMapName', () => {
  it('rejects a reserved map name surrounded by whitespace', () => {
    expect(validateMapName('  CON  ')).toBe('reserved');
  });

  it('accepts a multi-digit COM map name outside the reserved device range', () => {
    expect(validateMapName('COM10')).toBeNull();
  });

  it('rejects LPT0 at the lower printer device boundary', () => {
    expect(validateMapName('LPT0')).toBe('reserved');
  });

  it('rejects COM0 at the lower reserved device boundary', () => {
    expect(validateMapName('COM0')).toBe('reserved');
  });

  it('rejects a colon inside a map name beyond the drive-letter position', () => {
    expect(validateMapName('Town:Square')).toBe('invalid-chars');
  });

  it('rejects COM9 at the upper reserved device boundary', () => {
    expect(validateMapName('COM9')).toBe('reserved');
  });

  it('rejects a double quote inside a map filename', () => {
    expect(validateMapName('Town"Square')).toBe('invalid-chars');
  });

  it('accepts a map name that only ends with a reserved device name', () => {
    expect(validateMapName('Falcon')).toBeNull();
  });

  it('rejects a closing angle bracket in a map filename', () => {
    expect(validateMapName('Town>Square')).toBe('invalid-chars');
  });

  it('rejects a question mark in a map filename', () => {
    expect(validateMapName('Town?Square')).toBe('invalid-chars');
  });

  it('rejects the last C0 control character inside a map filename', () => {
    expect(validateMapName('Town\u001fSquare')).toBe('invalid-chars');
  });

  it('rejects DEL inside a map filename', () => {
    expect(validateMapName('Town\u007fSquare')).toBe('invalid-chars');
  });

  it('accepts a map name at the exact length limit', () => {
    expect(validateMapName('x'.repeat(MAP_NAME_MAX_LENGTH))).toBeNull();
  });

  it('rejects an asterisk in a map filename', () => {
    expect(validateMapName('draft*copy')).toBe('invalid-chars');
  });

  it('accepts ordinary stems including spaces and the legacy current name', () => {
    expect(validateMapName('current')).toBeNull();
    expect(validateMapName('town')).toBeNull();
    expect(validateMapName('Forest Path')).toBeNull();
    expect(validateMapName('  Castle  ')).toBeNull();
    expect(validateMapName('map_01')).toBeNull();
    expect(validateMapName('A-b')).toBeNull();
    expect(validateMapName(LEGACY_MAP_NAME)).toBeNull();
  });

  it('accepts Unicode characters in a map name', () => {
    expect(validateMapName('Niño')).toBeNull();
  });

  it('rejects empty, traversal, absolute, reserved, and illegal names', () => {
    expect(validateMapName('')).toBe('empty');
    expect(validateMapName('   ')).toBe('empty');
    expect(validateMapName('../evil')).toBe('dot-dot');
    expect(validateMapName('foo/../bar')).toBe('dot-dot');
    expect(validateMapName('..')).toBe('dot-dot');
    expect(validateMapName('.')).toBe('dot-dot');
    expect(validateMapName('foo/bar')).toBe('invalid-chars');
    expect(validateMapName('foo\\bar')).toBe('invalid-chars');
    expect(validateMapName('C:town')).toBe('absolute');
    expect(validateMapName('/etc/passwd')).toBe('absolute');
    expect(validateMapName('\\Windows\\System32')).toBe('absolute');
    expect(validateMapName('CON')).toBe('reserved');
    expect(validateMapName('con')).toBe('reserved');
    expect(validateMapName('Prn')).toBe('reserved');
    expect(validateMapName('AUX')).toBe('reserved');
    expect(validateMapName('NUL')).toBe('reserved');
    expect(validateMapName('COM1')).toBe('reserved');
    expect(validateMapName('lpt9')).toBe('reserved');
    expect(validateMapName('CON.foo')).toBe('reserved');
    expect(validateMapName('lpt1.backup')).toBe('reserved');
    expect(validateMapName('Nul.x')).toBe('reserved');
    expect(validateMapName('CONSOLE')).toBeNull();
    expect(validateMapName('console-room')).toBeNull();
    expect(validateMapName('Auxiliary')).toBeNull();
    expect(validateMapName('a<b')).toBe('invalid-chars');
    expect(validateMapName('a:b')).toBe('absolute');
    expect(validateMapName('a|b')).toBe('invalid-chars');
    expect(validateMapName('Town\nSquare')).toBe('invalid-chars');
    expect(validateMapName('ends.')).toBe('invalid-chars');
    expect(validateMapName('x'.repeat(MAP_NAME_MAX_LENGTH + 1))).toBe('too-long');
  });
});

describe('assertMapName / path derivation', () => {
  it('preserves the validation issue on a rejected map name', () => {
    expect(() => assertMapName('Castle?')).toThrowError(
      expect.objectContaining({ issue: 'invalid-chars' }),
    );
  });

  it('ignores backup filenames that contain but do not end with the map suffix', () => {
    expect(mapNameFromDocumentFileName('town.tmmap.json.bak')).toBeNull();
  });

  it('trims and returns a valid name; throws InvalidMapNameError otherwise', () => {
    expect(assertMapName('  town  ')).toBe('town');
    expect(() => assertMapName('../x')).toThrow(InvalidMapNameError);
    expect(() => assertMapName('../x')).toThrow(/dot-dot/);
  });

  it('builds Home-relative map paths under the maps directory', () => {
    expect(MAP_DIR_RELATIVE).toBe('.threemaker/maps');
    expect(MAP_FILE_SUFFIX).toBe('.tmmap.json');
    expect(INK_FILE_SUFFIX).toBe('.ink');
    expect(mapDocumentFileName('current')).toBe('current.tmmap.json');
    expect(mapFileRelativePath('current')).toBe('.threemaker/maps/current.tmmap.json');
    expect(mapFileRelativePath('Forest Path')).toBe('.threemaker/maps/Forest Path.tmmap.json');
    expect(() => mapFileRelativePath('../x')).toThrow(InvalidMapNameError);
  });

  it('parses a document filename back to a map name, or null', () => {
    expect(mapNameFromDocumentFileName('current.tmmap.json')).toBe('current');
    expect(mapNameFromDocumentFileName('Forest Path.tmmap.json')).toBe('Forest Path');
    expect(mapNameFromDocumentFileName('current.elder.ink')).toBeNull();
    expect(mapNameFromDocumentFileName('notes.txt')).toBeNull();
    expect(mapNameFromDocumentFileName('../evil.tmmap.json')).toBeNull();
  });
});

describe('list / sidecar / rename / delete plans', () => {
  const entries = [
    'current.tmmap.json',
    'current.elder.ink',
    'current.guard.ink',
    'town.tmmap.json',
    'town.welcome.ink',
    'notes.txt',
    '../evil.tmmap.json',
    'current.not-a-story',
  ];

  it('lists only valid map document stems, including legacy current', () => {
    expect(listMapNamesFromEntries(entries)).toEqual(['current', 'town']);
  });

  it('sorts saved map names independently of directory entry order', () => {
    expect(listMapNamesFromEntries(['zeta.tmmap.json', 'alpha.tmmap.json'])).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('identifies ink sidecars that belong to a map', () => {
    expect(isInkSidecarForMap('current.elder.ink', 'current')).toBe(true);
    expect(isInkSidecarForMap('current.guard.ink', 'current')).toBe(true);
    expect(isInkSidecarForMap('town.welcome.ink', 'current')).toBe(false);
    expect(isInkSidecarForMap('current.tmmap.json', 'current')).toBe(false);
    expect(isInkSidecarForMap('current.has.dot.ink', 'current')).toBe(false);
  });

  it('lists only path-safe story ids for the named map, ignoring other files', () => {
    expect(listInkStoryIdsFromEntries(entries, 'current')).toEqual(['elder', 'guard']);
    expect(listInkStoryIdsFromEntries(entries, 'town')).toEqual(['welcome']);
  });

  it('sorts ink story ids independently of directory entry order', () => {
    expect(
      listInkStoryIdsFromEntries(['current.zeta.ink', 'current.alpha.ink'], 'current'),
    ).toEqual(['alpha', 'zeta']);
  });

  it('drops sidecar names that would escape the maps directory', () => {
    const malicious = [
      'current.elder.ink',
      'current../evil.ink',
      'current..\\evil.ink',
      'current.foo/bar.ink',
      'current.foo\\bar.ink',
      '../current.sneak.ink',
      'current.../../passwd.ink',
      'current.has.dot.ink',
      'current. has space.ink',
      'town.welcome.ink',
    ];
    expect(listInkStoryIdsFromEntries(malicious, 'current')).toEqual(['elder']);
  });

  it('renames a map and moves its .ink sidecars with it', () => {
    expect(planRenameMapFiles('current', 'overworld', entries)).toEqual([
      {
        from: '.threemaker/maps/current.tmmap.json',
        to: '.threemaker/maps/overworld.tmmap.json',
      },
      {
        from: '.threemaker/maps/current.elder.ink',
        to: '.threemaker/maps/overworld.elder.ink',
      },
      {
        from: '.threemaker/maps/current.guard.ink',
        to: '.threemaker/maps/overworld.guard.ink',
      },
    ]);
  });

  it('does not plan moves when the map name is unchanged', () => {
    expect(planRenameMapFiles('town', 'town', entries)).toEqual([]);
  });

  it('refuses a rename that would overwrite another saved map', () => {
    expect(() => planRenameMapFiles('current', 'town', entries)).toThrow(/already exists/i);
  });

  it('refuses a case-only rename onto a different saved map', () => {
    const mixed = ['alpha.tmmap.json', 'town.tmmap.json', 'alpha.intro.ink'];
    expect(() => planRenameMapFiles('alpha', 'TOWN', mixed)).toThrow(/already exists/i);
  });

  it('allows a case-only rename of the same map and still moves its .ink sidecars', () => {
    expect(planRenameMapFiles('town', 'Town', entries)).toEqual([
      {
        from: '.threemaker/maps/town.tmmap.json',
        to: '.threemaker/maps/Town.tmmap.json',
      },
      {
        from: '.threemaker/maps/town.welcome.ink',
        to: '.threemaker/maps/Town.welcome.ink',
      },
    ]);
  });

  it('refuses a traversal rename target', () => {
    expect(() => planRenameMapFiles('town', '../evil', entries)).toThrow(InvalidMapNameError);
  });

  it('deletes a map file and its .ink sidecars only', () => {
    expect(planDeleteMapFiles('current', entries)).toEqual([
      '.threemaker/maps/current.tmmap.json',
      '.threemaker/maps/current.elder.ink',
      '.threemaker/maps/current.guard.ink',
    ]);
  });
});

describe('filename case folding', () => {
  it('detects a saved map collision after trimming both ends of the candidate', () => {
    expect(collidingSavedMapName('  TOWN  ', ['alpha', 'town'])).toBe('town');
  });

  it('compares map file names by ASCII case-fold, not locale collation', () => {
    expect(foldMapFileName('TOWN.tmmap.json')).toBe('town.tmmap.json');
    expect(mapFileNamesEqual('town.tmmap.json', 'TOWN.tmmap.json')).toBe(true);
    expect(mapFileNamesEqual('town.tmmap.json', 'alpha.tmmap.json')).toBe(false);
  });

  it('finds a saved map that collides with a create name ignoring case', () => {
    expect(collidingSavedMapName('TOWN', ['alpha', 'town'])).toBe('town');
    expect(collidingSavedMapName('town', ['town'])).toBe('town');
    expect(collidingSavedMapName('Castle', ['town'])).toBeUndefined();
  });

  it('detects a case-insensitive collision for a one-letter map name', () => {
    expect(collidingSavedMapName('A', ['a'])).toBe('a');
  });
});

describe('shouldConfirmPlaytestDualWrite', () => {
  it('confirms when a named map would overwrite an existing current', () => {
    expect(
      shouldConfirmPlaytestDualWrite({
        openMapName: 'town',
        savedMapNames: ['town', LEGACY_MAP_NAME],
      }),
    ).toBe(true);
  });

  it('does not confirm when current is the open map or does not exist yet', () => {
    expect(
      shouldConfirmPlaytestDualWrite({
        openMapName: LEGACY_MAP_NAME,
        savedMapNames: [LEGACY_MAP_NAME],
      }),
    ).toBe(false);
    expect(
      shouldConfirmPlaytestDualWrite({
        openMapName: 'town',
        savedMapNames: ['town'],
      }),
    ).toBe(false);
  });
});

it('accepts a multi-digit LPT map name outside the reserved device range', () => {
  expect(validateMapName('LPT10')).toBeNull();
});

it('does not confirm a dual write when the custom playtest target is already open', () => {
  expect(
    shouldConfirmPlaytestDualWrite({
      openMapName: 'preview',
      savedMapNames: ['preview'],
      legacyMapName: 'preview',
    }),
  ).toBe(false);
});

it('rejects a control character at the start of a map name', () => {
  expect(validateMapName('\u0000Harbor')).toBe('invalid-chars');
});

it('confirms overwriting current when the open map name sorts before it', () => {
  expect(
    shouldConfirmPlaytestDualWrite({
      openMapName: 'castle',
      savedMapNames: ['current'],
    }),
  ).toBe(true);
});

it('preserves surrounding whitespace in an invalid map name diagnostic', () => {
  expect(() => assertMapName('  Town?Square  ')).toThrow(
    'Invalid map name "  Town?Square  " (invalid-chars)',
  );
});

it('accepts a map name pasted with surrounding tabs and newlines', () => {
  expect(validateMapName('\tHarbor\n')).toBeNull();
});

it('keeps non-Ink files when deleting a map whose name contains the Ink extension', () => {
  expect(planDeleteMapFiles('town.ink', ['town.ink.elder.ink', 'town.ink.notes.txt'])).toEqual([
    '.threemaker/maps/town.ink.tmmap.json',
    '.threemaker/maps/town.ink.elder.ink',
  ]);
});

it('classifies a colon after an underscore as an invalid character rather than a drive prefix', () => {
  expect(validateMapName('_:harbor')).toBe('invalid-chars');
});

it('keeps an embedded map-name suffix out of the delete plan', () => {
  expect(planDeleteMapFiles('town', ['town.greeting.ink', 'uptown.ink'])).toEqual([
    '.threemaker/maps/town.tmmap.json',
    '.threemaker/maps/town.greeting.ink',
  ]);
});

it('reports the first saved spelling when several map names collide', () => {
  expect(collidingSavedMapName('town', ['Town', 'TOWN'])).toBe('Town');
});

it('loads a valid map stem when its filename exceeds the stem length limit', () => {
  const name = 'n'.repeat(54);

  expect(mapNameFromDocumentFileName(`${name}.tmmap.json`)).toBe(name);
});

it('accepts 64-character map names and rejects 65-character names', () => {
  expect(validateMapName('n'.repeat(64))).toBeNull();
  expect(validateMapName('n'.repeat(65))).toBe('too-long');
});

it('rejects a reserved device name with a hyphenated extension', () => {
  expect(validateMapName('CON.saved-map')).toBe('reserved');
});

it('accepts COM as a map name without a device number', () => {
  expect(validateMapName('COM')).toBeNull();
});

it('accepts LPT as a map name without a device number', () => {
  expect(validateMapName('LPT')).toBeNull();
});

it('classifies the final drive letter as an absolute map-name prefix in either case', () => {
  expect(validateMapName('Z:harbor')).toBe('absolute');
  expect(validateMapName('z:harbor')).toBe('absolute');
});

it('confirms overwriting a saved custom playtest target', () => {
  expect(
    shouldConfirmPlaytestDualWrite({
      openMapName: 'harbor',
      savedMapNames: ['preview'],
      legacyMapName: 'preview',
    }),
  ).toBe(true);
});

it('classifies the first uppercase drive letter as an absolute map-name prefix', () => {
  expect(validateMapName('A:harbor')).toBe('absolute');
});

it('identifies rejected map names in the displayed error diagnostic', () => {
  const error = new InvalidMapNameError('invalid-chars', 'Harbor?');
  expect(error.toString()).toBe('InvalidMapNameError: Invalid map name "Harbor?" (invalid-chars)');
});

it('classifies a leading colon without a drive letter as an invalid filename character', () => {
  expect(validateMapName(':harbor')).toBe('invalid-chars');
});

it('classifies a pipe before a colon as an invalid filename character', () => {
  expect(validateMapName('|:harbor')).toBe('invalid-chars');
});

it('accepts a maximum-length map name pasted with surrounding whitespace', () => {
  const name = 'm'.repeat(MAP_NAME_MAX_LENGTH);

  expect(validateMapName(`  ${name}  `)).toBeNull();
});

it('uses the first matching document filename when entry spellings differ by case', () => {
  const entries = ['notes.txt', 'Harbor.tmmap.json', 'HARBOR.tmmap.json'];

  expect(existingMapDocumentFileName('HARBOR', entries)).toBe('Harbor.tmmap.json');
});

it('accepts square brackets in an authored map name', () => {
  expect(validateMapName('Harbor [East]')).toBeNull();
});

it('classifies a digit before a colon as an invalid filename character', () => {
  expect(validateMapName('1:harbor')).toBe('invalid-chars');
});

it('accepts a reserved word after a separator in an ordinary map name', () => {
  expect(validateMapName('Harbor CON')).toBeNull();
});

it('accepts a map name that extends a reserved word with a hyphen', () => {
  expect(validateMapName('CON-harbor')).toBeNull();
});

it('accepts CO as an ordinary map name', () => {
  expect(validateMapName('CO')).toBeNull();
});

it('rejects a reserved device name with spaces inside its extension', () => {
  expect(validateMapName('CON.saved map')).toBe('reserved');
});

it('reports an embedded drive prefix as an invalid filename character', () => {
  expect(validateMapName('Harbor A:annex')).toBe('invalid-chars');
});

it('accepts PR as an ordinary map name', () => {
  expect(validateMapName('PR')).toBeNull();
});

it('accepts AU as an ordinary map name', () => {
  expect(validateMapName('AU')).toBeNull();
});

it('accepts NU as an ordinary map name', () => {
  expect(validateMapName('NU')).toBeNull();
});
