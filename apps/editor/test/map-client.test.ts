import { createBlankMapDocument } from '../src/map-compose.js';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeTextFile: vi.fn(async () => undefined),
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: fsMocks.mkdir,
  writeTextFile: fsMocks.writeTextFile,
  readTextFile: fsMocks.readTextFile,
  exists: fsMocks.exists,
  BaseDirectory: { Home: 'Home' },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMapDocument, MapClientError, saveMapDocument } from '../src/map-client.js';

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
});
