/**
 * Community share preferences for Maker Studio (product surface v0).
 *
 * No network yet: save path can read these flags and enqueue a stub payload.
 * Default product intent: share-on-save is ON, but imported RPGM assets stay OFF.
 */

const STORAGE_KEY = 'threemaker-maker-studio:community';
const QUEUE_STORAGE_KEY = 'threemaker-maker-studio:community-queue';

/** Max offline share jobs retained for the inspector status (newest first). */
export const COMMUNITY_SHARE_QUEUE_MAX = 20;

export type CommunitySettings = {
  /** When true, map saves enqueue a community share job (opt-out). */
  readonly shareOnSave: boolean;
  /** When false, maps that only use import-rpgm assets are not shared. */
  readonly allowImportedAssets: boolean;
};

export const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  shareOnSave: true,
  allowImportedAssets: false,
};

export function loadCommunitySettings(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): CommunitySettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COMMUNITY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CommunitySettings>;
    return {
      shareOnSave:
        typeof parsed.shareOnSave === 'boolean'
          ? parsed.shareOnSave
          : DEFAULT_COMMUNITY_SETTINGS.shareOnSave,
      allowImportedAssets:
        typeof parsed.allowImportedAssets === 'boolean'
          ? parsed.allowImportedAssets
          : DEFAULT_COMMUNITY_SETTINGS.allowImportedAssets,
    };
  } catch {
    return DEFAULT_COMMUNITY_SETTINGS;
  }
}

export function saveCommunitySettings(
  settings: CommunitySettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export type CommunityShareEnqueue = {
  readonly mapId: string;
  readonly mapName: string;
  readonly tileObjectShas: readonly string[];
  readonly at: string;
};

function isShareEnqueue(value: unknown): value is CommunityShareEnqueue {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mapId === 'string' &&
    typeof v.mapName === 'string' &&
    typeof v.at === 'string' &&
    Array.isArray(v.tileObjectShas) &&
    v.tileObjectShas.every((s) => typeof s === 'string')
  );
}

/** Offline share jobs waiting for a future community API (newest first). */
export function loadCommunityShareQueue(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isShareEnqueue).slice(0, COMMUNITY_SHARE_QUEUE_MAX);
  } catch {
    return [];
  }
}

/**
 * Prepend a share job and persist. Drops oldest when over the cap.
 * Returns the updated queue (newest first).
 */
export function pushCommunityShareQueue(
  job: CommunityShareEnqueue,
  storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  const next = [job, ...loadCommunityShareQueue(storage)].slice(0, COMMUNITY_SHARE_QUEUE_MAX);
  storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Drop every offline share job (user "Clear queue" action). */
export function clearCommunityShareQueue(
  storage: Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(QUEUE_STORAGE_KEY);
  } else {
    storage.setItem(QUEUE_STORAGE_KEY, '[]');
  }
  return [];
}

export type CommunityShareStatus = {
  readonly kind: 'off' | 'ready' | 'queued';
  readonly queueLength: number;
  readonly lastMapName?: string;
};

/**
 * Pure inspector status for the community section (no I/O).
 * `queue` is newest-first; lastMapName is the newest job when present.
 */
export function describeCommunityShareStatus(
  settings: CommunitySettings,
  queue: readonly CommunityShareEnqueue[],
): CommunityShareStatus {
  const lastMapName = queue[0]?.mapName;
  const base =
    lastMapName === undefined
      ? { queueLength: queue.length }
      : { queueLength: queue.length, lastMapName };
  if (!settings.shareOnSave) {
    return { kind: 'off', ...base };
  }
  if (queue.length === 0) {
    return { kind: 'ready', queueLength: 0 };
  }
  return { kind: 'queued', ...base };
}

/**
 * Build a share payload if settings allow. Returns null when the user opted out.
 * Network upload is intentionally not implemented here.
 */
export function maybeEnqueueCommunityShare(
  settings: CommunitySettings,
  input: {
    readonly mapId: string;
    readonly mapName: string;
    readonly tileObjectShas: readonly string[];
    readonly usesOnlyImportedAssets: boolean;
    readonly now?: () => string;
  },
): CommunityShareEnqueue | null {
  if (!settings.shareOnSave) return null;
  if (input.usesOnlyImportedAssets && !settings.allowImportedAssets) return null;
  return {
    mapId: input.mapId,
    mapName: input.mapName,
    tileObjectShas: input.tileObjectShas,
    at: (input.now ?? (() => new Date().toISOString()))(),
  };
}
