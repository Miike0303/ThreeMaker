import { createBlankMapDocument } from '../src/map-compose.js';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeTextFile: vi.fn(async () => undefined),
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
  readDir: vi.fn(async () => [] as { name: string }[]),
  rename: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: fsMocks.mkdir,
  writeTextFile: fsMocks.writeTextFile,
  readTextFile: fsMocks.readTextFile,
  exists: fsMocks.exists,
  readDir: fsMocks.readDir,
  rename: fsMocks.rename,
  remove: fsMocks.remove,
  BaseDirectory: { Home: 'Home' },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSavedMap,
  listSavedMaps,
  loadMapDocument,
  MapClientError,
  renameSavedMap,
  saveMapDocument,
} from '../src/map-client.js';

const doc = createBlankMapDocument({
  id: 'map-1',
  name: 'Demo',
  width: 3,
  height: 2,
  slots: { A2: { object: 'sha-a', sourceTilesetId: 1, sourceGameId: 1 } },
  flags: new Array(8192).fill(0),
});

function stubTauriHost(): void {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

describe('map-client (Tauri fs branch)', () => {
  beforeEach(() => {
    fsMocks.mkdir.mockClear();
    fsMocks.writeTextFile.mockClear();
    fsMocks.readTextFile.mockClear();
    fsMocks.exists.mockClear();
    fsMocks.readDir.mockClear();
    fsMocks.rename.mockClear();
    fsMocks.remove.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveMapDocument mkdirs the maps directory then writes the serialized document under BaseDirectory.Home', async () => {
    stubTauriHost();

    await saveMapDocument(doc);

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      '.threemaker/maps',
      expect.objectContaining({ baseDir: 'Home', recursive: true }),
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenText, writeOptions] = fsMocks.writeTextFile.mock.calls[0];
    expect(writtenPath).toBe('.threemaker/maps/current.tmmap.json');
    expect(JSON.parse(writtenText)).toMatchObject({ id: 'map-1' });
    expect(writeOptions).toMatchObject({ baseDir: 'Home' });
  });

  it('loadMapDocument returns null when the shared file does not exist yet', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(false);

    const result = await loadMapDocument();

    expect(result).toBeNull();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });

  it('loadMapDocument round-trips a previously saved document', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(JSON.stringify(doc));

    const result = await loadMapDocument();

    expect(result).toEqual(doc);
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      '.threemaker/maps/current.tmmap.json',
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('loadMapDocument throws MapClientError when the saved file fails schema validation', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(JSON.stringify({ not: 'a map document' }));

    await expect(loadMapDocument()).rejects.toThrow();
  });

  it('saveMapDocument writes a named map file, not a shared current', async () => {
    stubTauriHost();

    await saveMapDocument(doc, 'town');

    const [writtenPath] = fsMocks.writeTextFile.mock.calls[0];
    expect(writtenPath).toBe('.threemaker/maps/town.tmmap.json');
  });

  it('saveMapDocument rejects a traversal map name before touching the filesystem', async () => {
    stubTauriHost();

    await expect(saveMapDocument(doc, '../evil')).rejects.toThrow(MapClientError);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    expect(fsMocks.mkdir).not.toHaveBeenCalled();
  });

  it('saveMapDocument refuses a case-only collision with another saved map before writing', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([{ name: 'town.tmmap.json' }]);

    await expect(saveMapDocument(doc, 'TOWN')).rejects.toThrow(/already exists/i);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it('saveMapDocument still overwrites the exact same saved map name', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([{ name: 'town.tmmap.json' }]);

    await saveMapDocument(doc, 'town');

    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.writeTextFile.mock.calls[0][0]).toBe('.threemaker/maps/town.tmmap.json');
  });

  it('loadMapDocument still opens a legacy current.tmmap.json when asked for current', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(JSON.stringify(doc));

    const result = await loadMapDocument('current');

    expect(result).toEqual(doc);
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      '.threemaker/maps/current.tmmap.json',
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('listSavedMaps returns named maps including a legacy current file', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      { name: 'current.tmmap.json' },
      { name: 'current.elder.ink' },
      { name: 'town.tmmap.json' },
    ]);

    expect(await listSavedMaps()).toEqual(['current', 'town']);
  });

  it('listSavedMaps returns an empty list when the maps directory does not exist yet', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(false);

    expect(await listSavedMaps()).toEqual([]);
    expect(fsMocks.readDir).not.toHaveBeenCalled();
  });

  it('renameSavedMap moves the map file and its .ink sidecars', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      { name: 'current.tmmap.json' },
      { name: 'current.elder.ink' },
      { name: 'town.tmmap.json' },
    ]);

    await renameSavedMap('current', 'overworld');

    expect(fsMocks.rename).toHaveBeenCalledTimes(2);
    expect(fsMocks.rename).toHaveBeenNthCalledWith(
      1,
      '.threemaker/maps/current.tmmap.json',
      '.threemaker/maps/overworld.tmmap.json',
      expect.objectContaining({ oldPathBaseDir: 'Home', newPathBaseDir: 'Home' }),
    );
    expect(fsMocks.rename).toHaveBeenNthCalledWith(
      2,
      '.threemaker/maps/current.elder.ink',
      '.threemaker/maps/overworld.elder.ink',
      expect.objectContaining({ oldPathBaseDir: 'Home', newPathBaseDir: 'Home' }),
    );
  });

  it('deleteSavedMap removes the map file and its .ink sidecars', async () => {
    stubTauriHost();
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      { name: 'town.tmmap.json' },
      { name: 'town.welcome.ink' },
    ]);

    await deleteSavedMap('town');

    expect(fsMocks.remove).toHaveBeenCalledTimes(2);
    expect(fsMocks.remove).toHaveBeenNthCalledWith(
      1,
      '.threemaker/maps/town.tmmap.json',
      expect.objectContaining({ baseDir: 'Home' }),
    );
    expect(fsMocks.remove).toHaveBeenNthCalledWith(
      2,
      '.threemaker/maps/town.welcome.ink',
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });
});

describe('map-client (dev-HTTP fallback, unchanged outside a Tauri host)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('saveMapDocument POSTs to the dev-map API and never touches the fs mocks', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await saveMapDocument(doc);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dev-map/save',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fsMocks.mkdir).not.toHaveBeenCalled();
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it('saveMapDocument throws MapClientError on a non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(saveMapDocument(doc)).rejects.toThrow(MapClientError);
  });

  it('loadMapDocument returns null on a 404 from the dev-map API', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    expect(await loadMapDocument()).toBeNull();
  });

  it('saveMapDocument for a named map POSTs with a name query', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await saveMapDocument(doc, 'town');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dev-map/save?name=town',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
