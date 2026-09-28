const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(async () => ''),
  readFile: vi.fn(async () => new Uint8Array()),
  exists: vi.fn(async () => false),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: fsMocks.readTextFile,
  readFile: fsMocks.readFile,
  exists: fsMocks.exists,
  BaseDirectory: { Home: 'Home' },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MANIFEST_FILE_RELATIVE,
  MAP_DIR_RELATIVE,
  MAP_FILE_RELATIVE,
  readManifestText,
  readMapAssetBytes,
  readMapDocumentText,
} from '../src/map-file.js';

describe('map-file (shared working-map read helper)', () => {
  beforeEach(() => {
    fsMocks.readTextFile.mockClear();
    fsMocks.readFile.mockClear();
    fsMocks.exists.mockClear();
  });

  it('returns null when the shared map file does not exist yet, without reading it', async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    const result = await readMapDocumentText();

    expect(result).toBeNull();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });

  it('reads the shared map file text under BaseDirectory.Home when it exists', async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce('{"id":"map-1"}');

    const result = await readMapDocumentText();

    expect(result).toBe('{"id":"map-1"}');
    expect(fsMocks.exists).toHaveBeenCalledWith(
      MAP_FILE_RELATIVE,
      expect.objectContaining({ baseDir: 'Home' }),
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      MAP_FILE_RELATIVE,
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('reads an arbitrary relative path when one is passed (multi-map navigation)', async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce('{"id":"map-7"}');
    const customPath = '.threemaker/maps/kingdom-of-subversion/map007.tmmap.json';

    const result = await readMapDocumentText(customPath);

    expect(result).toBe('{"id":"map-7"}');
    expect(fsMocks.exists).toHaveBeenCalledWith(
      customPath,
      expect.objectContaining({ baseDir: 'Home' }),
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      customPath,
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('returns null when the manifest file does not exist yet, without reading it', async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    const result = await readManifestText();

    expect(result).toBeNull();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });

  it('reads the manifest file text under BaseDirectory.Home when it exists', async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce('{"maps":[]}');

    const result = await readManifestText();

    expect(result).toBe('{"maps":[]}');
    expect(fsMocks.exists).toHaveBeenCalledWith(
      MANIFEST_FILE_RELATIVE,
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('returns an exact, independent copy of the asset byte view', async () => {
    const backing = new Uint8Array([99, 11, 22, 88]);
    fsMocks.readFile.mockResolvedValueOnce(backing.subarray(1, 3));

    const result = await readMapAssetBytes('audio/bgm.ogg');

    expect(Array.from(new Uint8Array(result))).toEqual([11, 22]);
    expect(result).not.toBe(backing.buffer);
    new Uint8Array(result)[0] = 0;
    expect(Array.from(backing)).toEqual([99, 11, 22, 88]);
    expect(fsMocks.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/audio\/bgm\.ogg$/),
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('reads an asset relative to the maps directory', async () => {
    await readMapAssetBytes('audio/bgm.ogg');

    expect(fsMocks.readFile).toHaveBeenCalledWith(`${MAP_DIR_RELATIVE}/audio/bgm.ogg`, {
      baseDir: 'Home',
    });
  });

  it('reads the manifest from the published manifest.json path', async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce('{"maps":[]}');

    await expect(readManifestText()).resolves.toBe('{"maps":[]}');

    expect(fsMocks.exists).toHaveBeenCalledWith('.threemaker/maps/manifest.json', {
      baseDir: 'Home',
    });
    expect(fsMocks.readTextFile).toHaveBeenCalledWith('.threemaker/maps/manifest.json', {
      baseDir: 'Home',
    });
  });

  it('reads the default working map from the published current.tmmap.json path', async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce('{"id":"current-map"}');

    await expect(readMapDocumentText()).resolves.toBe('{"id":"current-map"}');

    expect(fsMocks.exists).toHaveBeenCalledWith('.threemaker/maps/current.tmmap.json', {
      baseDir: 'Home',
    });
    expect(fsMocks.readTextFile).toHaveBeenCalledWith('.threemaker/maps/current.tmmap.json', {
      baseDir: 'Home',
    });
  });
});
