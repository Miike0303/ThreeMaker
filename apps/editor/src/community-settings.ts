/**
 * Community share preferences for Maker Studio (product surface v0).
 *
 * No network yet: save path can read these flags and enqueue a stub payload.
 * Default product intent: share-on-save is ON, but imported RPGM assets stay OFF.
 */

const STORAGE_KEY = 'threemaker-maker-studio:community';

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
