import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { openPlaytest } from '../src/playtest-client.js';

describe('playtest-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });

  it('openPlaytest throws PlaytestClientError when Tauri is unavailable', async () => {
    vi.stubGlobal('window', {});

    await expect(openPlaytest()).rejects.toMatchObject({
      name: 'PlaytestClientError',
      code: 'NotFound',
    });
  });

  it('openPlaytest maps invoke errors to PlaytestClientError', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invokeMock.mockRejectedValueOnce({ code: 'SpawnFailed', message: 'spawn denied' });

    await expect(openPlaytest()).rejects.toMatchObject({
      name: 'PlaytestClientError',
      code: 'SpawnFailed',
      message: 'spawn denied',
    });
  });
});
