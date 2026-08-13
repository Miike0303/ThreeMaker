/**
 * Named-map identity: filename validation, path derivation, list/rename/delete
 * plans, and legacy `current.tmmap.json` adoption (WU-B).
 */
import { describe, expect, it } from 'vitest';
import {
  assertMapName,
  collidingSavedMapName,
  foldMapFileName,
  INK_FILE_SUFFIX,
  InvalidMapNameError,
  isInkSidecarForMap,
  LEGACY_MAP_NAME,
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
  validateMapName,
} from '../src/map-identity.js';

describe('validateMapName', () => {
  it('accepts ordinary stems including spaces and the legacy current name', () => {
    expect(validateMapName('current')).toBeNull();
    expect(validateMapName('town')).toBeNull();
    expect(validateMapName('Forest Path')).toBeNull();
    expect(validateMapName('  Castle  ')).toBeNull();
    expect(validateMapName('map_01')).toBeNull();
    expect(validateMapName('A-b')).toBeNull();
    expect(validateMapName(LEGACY_MAP_NAME)).toBeNull();
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
    expect(validateMapName('a<b')).toBe('invalid-chars');
    expect(validateMapName('a:b')).toBe('absolute');
    expect(validateMapName('a|b')).toBe('invalid-chars');
    expect(validateMapName('ends.')).toBe('invalid-chars');
    expect(validateMapName('x'.repeat(MAP_NAME_MAX_LENGTH + 1))).toBe('too-long');
  });
});

describe('assertMapName / path derivation', () => {
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

  it('identifies ink sidecars that belong to a map', () => {
    expect(isInkSidecarForMap('current.elder.ink', 'current')).toBe(true);
    expect(isInkSidecarForMap('current.guard.ink', 'current')).toBe(true);
    expect(isInkSidecarForMap('town.welcome.ink', 'current')).toBe(false);
    expect(isInkSidecarForMap('current.tmmap.json', 'current')).toBe(false);
    expect(isInkSidecarForMap('current.has.dot.ink', 'current')).toBe(false);
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
});
