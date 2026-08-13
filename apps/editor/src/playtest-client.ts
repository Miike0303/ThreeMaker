/**
 * Desktop playtest launcher (editor → `apps/desktop` binary).
 */

import { isTauriAvailable } from './catalog-client.js';

export type PlaytestErrorCode = 'NotFound' | 'SpawnFailed';

export class PlaytestClientError extends Error {
  readonly code: PlaytestErrorCode;

  constructor(code: PlaytestErrorCode, message: string) {
    super(message);
    this.name = 'PlaytestClientError';
    this.code = code;
  }
}

/** Spawns the ThreeMaker desktop playtest binary. Requires the Tauri editor host. */
export async function openPlaytest(): Promise<void> {
  if (!isTauriAvailable()) {
    throw new PlaytestClientError('NotFound', 'Playtest requires the desktop editor app.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke<void>('open_playtest');
  } catch (err) {
    const payload = err as { code?: PlaytestErrorCode; message?: string } | string;
    if (typeof payload === 'object' && payload?.code) {
      throw new PlaytestClientError(payload.code, payload.message ?? payload.code);
    }
    throw new PlaytestClientError('SpawnFailed', String(payload));
  }
}
