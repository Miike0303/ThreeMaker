const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: fsMocks.readTextFile,
  exists: fsMocks.exists,
  BaseDirectory: { Home: 'Home' },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAP_FILE_RELATIVE, readMapDocumentText } from '../src/map-file.js';

describe('map-file (shared working-map read helper)', () => {
  beforeEach(() => {
    fsMocks.readTextFile.mockClear();
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
});
