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

import {
  Actions,
  createBindingTable,
  defaultKeyboardBindings,
  rebindKeyboard,
  serializeInputBindingsDocument,
} from '@threemaker/input';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INPUT_BINDINGS_FILE_RELATIVE,
  INPUT_BINDINGS_STORAGE_KEY,
  loadInputBindingTable,
  saveInputBindingTable,
} from '../src/input-bindings-store.js';

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

describe('input-bindings-store', () => {
  beforeEach(() => {
    fsMocks.readTextFile.mockClear();
    fsMocks.writeTextFile.mockClear();
    fsMocks.exists.mockClear();
    fsMocks.mkdir.mockClear();
    tauriMocks.isTauriAvailable.mockReset();
    tauriMocks.isTauriAvailable.mockReturnValue(false);
  });

  it('loads defaults when nothing is stored (localStorage path)', async () => {
    const table = await loadInputBindingTable(memoryStorage());
    expect(table.actionForKeyboardKey('e')).toBe(Actions.Interact);
  });

  it('loads remapped interact from localStorage and keeps other defaults', async () => {
    const text = serializeInputBindingsDocument([
      { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
    ]);
    const table = await loadInputBindingTable(
      memoryStorage({ [INPUT_BINDINGS_STORAGE_KEY]: text }),
    );
    expect(table.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(table.actionForKeyboardKey('e')).toBeUndefined();
    expect(table.actionForKeyboardKey('w')).toBe(Actions.MoveUp);
  });

  it('save then load round-trips a rebind via localStorage', async () => {
    const storage = memoryStorage();
    const remapped = rebindKeyboard(
      createBindingTable(defaultKeyboardBindings()),
      Actions.Interact,
      'f',
    );
    await saveInputBindingTable(remapped, storage);
    const loaded = await loadInputBindingTable(storage);
    expect(loaded.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(loaded.actionForKeyboardKey('e')).toBeUndefined();
  });

  it('uses Tauri Home path when available', async () => {
    tauriMocks.isTauriAvailable.mockReturnValue(true);
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(
      serializeInputBindingsDocument([
        { action: Actions.Interact, source: { device: 'keyboard', key: 'f' } },
      ]),
    );

    const table = await loadInputBindingTable(memoryStorage());
    expect(table.actionForKeyboardKey('f')).toBe(Actions.Interact);
    expect(fsMocks.exists).toHaveBeenCalledWith(
      INPUT_BINDINGS_FILE_RELATIVE,
      expect.objectContaining({ baseDir: 'Home' }),
    );
  });
});
