const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => undefined),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(async () => undefined),
}));

const tauriMocks = vi.hoisted(() => ({
  isTauriAvailable: vi.fn(() => false),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: fsMocks.readTextFile,
  writeTextFile: fsMocks.writeTextFile,
  exists: fsMocks.exists,
  mkdir: fsMocks.mkdir,
  BaseDirectory: { Home: 'Home' },
}));

vi.mock('../src/tauri-env.js', () => ({
  isTauriAvailable: tauriMocks.isTauriAvailable,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAME_SAVE_FILE_RELATIVE,
  GAME_SAVE_STORAGE_KEY,
  loadGameSaveSnapshot,
  persistGameSaveSnapshot,
} from '../src/game-save-store.js';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

const sample = {
  mapFile: 'demo/map-a.tmmap.json',
  x: 2,
  y: 3,
  floor: 0,
  facing: 'up' as const,
  world: { met_elder: true, gold: 5 },
  inventory: { potion: 2 },
  stats: { hp: 20 },
  stories: { elder: '{"inkSaveVersion":8}' },
};

describe('game-save-store', () => {
  beforeEach(() => {
    fsMocks.readTextFile.mockClear();
    fsMocks.writeTextFile.mockClear();
    fsMocks.exists.mockClear();
    fsMocks.mkdir.mockClear();
    tauriMocks.isTauriAvailable.mockReset();
    tauriMocks.isTauriAvailable.mockReturnValue(false);
  });

  it('returns not-ok when nothing is stored', async () => {
    const result = await loadGameSaveSnapshot(memoryStorage());
    expect(result.ok).toBe(false);
  });

  it('round-trips a snapshot through localStorage', async () => {
    const storage = memoryStorage();
    await expect(persistGameSaveSnapshot(sample, storage)).resolves.toBe(true);
    const loaded = await loadGameSaveSnapshot(storage);
    expect(loaded).toEqual({ ok: true, snapshot: sample });
    expect(storage.getItem(GAME_SAVE_STORAGE_KEY)).toContain('threemaker.game-save');
  });

  it('reports failure when storage setItem throws', async () => {
    const storage: Storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    await expect(persistGameSaveSnapshot(sample, storage)).resolves.toBe(false);
  });

  it('uses Tauri Home path when available', async () => {
    tauriMocks.isTauriAvailable.mockReturnValue(true);
    fsMocks.exists.mockResolvedValueOnce(false);
    await persistGameSaveSnapshot(sample, memoryStorage());
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      '.threemaker/saves',
      expect.objectContaining({ baseDir: 'Home', recursive: true }),
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      GAME_SAVE_FILE_RELATIVE,
      expect.any(String),
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });

  it('loads a C3-era v1 save file into a v3 snapshot with empty inventory/stats/stories', async () => {
    const v1Text = JSON.stringify({
      magic: 'threemaker.game-save',
      version: 1,
      player: {
        mapFile: 'demo/map-a.tmmap.json',
        x: 4,
        y: 5,
        floor: 0,
        facing: 'right',
      },
      world: { met_elder: true },
    });
    const storage = memoryStorage({ [GAME_SAVE_STORAGE_KEY]: v1Text });
    const loaded = await loadGameSaveSnapshot(storage);
    expect(loaded).toEqual({
      ok: true,
      snapshot: {
        mapFile: 'demo/map-a.tmmap.json',
        x: 4,
        y: 5,
        floor: 0,
        facing: 'right',
        world: { met_elder: true },
        inventory: {},
        stats: {},
        stories: {},
      },
    });
  });
});
