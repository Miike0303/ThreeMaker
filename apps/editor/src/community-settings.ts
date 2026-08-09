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

/** Coarse license/provenance tag for the offline share queue (future API). */
export type CommunityLicenseTag = 'user-owned' | 'import-rpgm' | 'mixed';

export const COMMUNITY_LICENSE_TAGS: readonly CommunityLicenseTag[] = [
  'user-owned',
  'import-rpgm',
  'mixed',
] as const;

export type CommunityShareEnqueue = {
  readonly mapId: string;
  readonly mapName: string;
  readonly tileObjectShas: readonly string[];
  readonly at: string;
  /** MapDocument.version at enqueue time (DESIGN share payload). */
  readonly version: number;
  /** Coarse provenance tag (DESIGN share payload). */
  readonly licenseTag: CommunityLicenseTag;
};

function isCommunityLicenseTag(value: unknown): value is CommunityLicenseTag {
  return (
    value === 'user-owned' || value === 'import-rpgm' || value === 'mixed'
  );
}

/**
 * Accepts well-shaped jobs including legacy queue entries missing version /
 * licenseTag (normalized to version 0 + user-owned).
 */
function normalizeShareEnqueue(value: unknown): CommunityShareEnqueue | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.mapId !== 'string' ||
    typeof v.mapName !== 'string' ||
    typeof v.at !== 'string' ||
    !Array.isArray(v.tileObjectShas) ||
    !v.tileObjectShas.every((s) => typeof s === 'string')
  ) {
    return null;
  }
  const version =
    typeof v.version === 'number' && Number.isFinite(v.version)
      ? Math.trunc(v.version)
      : 0;
  const licenseTag = isCommunityLicenseTag(v.licenseTag) ? v.licenseTag : 'user-owned';
  return {
    mapId: v.mapId,
    mapName: v.mapName,
    tileObjectShas: v.tileObjectShas as readonly string[],
    at: v.at,
    version,
    licenseTag,
  };
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
    return parsed
      .map(normalizeShareEnqueue)
      .filter((job): job is CommunityShareEnqueue => job !== null)
      .slice(0, COMMUNITY_SHARE_QUEUE_MAX);
  } catch {
    return [];
  }
}

/**
 * Prepend a share job and persist. Replaces any prior job with the same
 * `mapId` (re-save keeps one newest entry per map). Drops oldest when over
 * the cap. Returns the updated queue (newest first).
 */
export function pushCommunityShareQueue(
  job: CommunityShareEnqueue,
  storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  const rest = loadCommunityShareQueue(storage).filter((j) => j.mapId !== job.mapId);
  const next = [job, ...rest].slice(0, COMMUNITY_SHARE_QUEUE_MAX);
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

/**
 * Remove the first queue entry matching mapId + at (unique per save stamp).
 * No-op identity when no match. Persists and returns the updated queue.
 */
export function removeCommunityShareQueueJob(
  mapId: string,
  at: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  const current = loadCommunityShareQueue(storage);
  const idx = current.findIndex((job) => job.mapId === mapId && job.at === at);
  if (idx === -1) return current;
  const next = current.filter((_, i) => i !== idx);
  storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Pure: stable JSON export of the offline queue (for debug / future upload). */
export function serializeCommunityShareQueue(queue: readonly CommunityShareEnqueue[]): string {
  return JSON.stringify(queue, null, 2);
}

export type ParseCommunityShareQueueResult =
  | { readonly ok: true; readonly jobs: readonly CommunityShareEnqueue[] }
  | {
      readonly ok: false;
      readonly reason: 'invalid-json' | 'not-array' | 'no-valid-jobs';
    };

/**
 * Pure: parse a previously exported (or hand-edited) queue JSON.
 * Keeps only well-shaped jobs, newest-first order preserved, capped at max.
 */
export function parseCommunityShareQueueJson(raw: string): ParseCommunityShareQueueResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'not-array' };
  }
  const jobs = parsed
    .map(normalizeShareEnqueue)
    .filter((job): job is CommunityShareEnqueue => job !== null)
    .slice(0, COMMUNITY_SHARE_QUEUE_MAX);
  if (jobs.length === 0) {
    return { ok: false, reason: 'no-valid-jobs' };
  }
  return { ok: true, jobs };
}

/**
 * Replace the entire offline queue with `jobs` (already validated/capped preferred).
 * Persists and returns the stored queue (re-filtered + capped for safety).
 */
export function replaceCommunityShareQueue(
  jobs: readonly CommunityShareEnqueue[],
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): readonly CommunityShareEnqueue[] {
  const next = jobs
    .map(normalizeShareEnqueue)
    .filter((job): job is CommunityShareEnqueue => job !== null)
    .slice(0, COMMUNITY_SHARE_QUEUE_MAX);
  storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export type CommunityShareStatus = {
  readonly kind: 'off' | 'ready' | 'queued';
  readonly queueLength: number;
  readonly lastMapName?: string;
};

/**
 * Format an offline queue `at` ISO timestamp for list rows (WU-COMM-09).
 * Invalid / non-date input returns the original string unchanged.
 * `locale` is optional BCP 47 (e.g. `en`, `es`); omit for runtime default.
 */
export function formatCommunityShareAt(at: string, locale?: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return at;
  }
}

/**
 * Count unique non-empty tile object shas on a share job (WU-COMM-10).
 * Duplicates and blank entries do not inflate the queue row badge.
 */
export function communityShareTileCount(
  tileObjectShas: readonly string[],
): number {
  const seen = new Set<string>();
  for (const sha of tileObjectShas) {
    if (typeof sha === 'string' && sha.length > 0) seen.add(sha);
  }
  return seen.size;
}

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
 * Minimal slot shape for the imported-asset gate (matches map-format `SlotSource`
 * without depending on that package from this settings module).
 */
export type SlotSourceLike = {
  readonly object?: string;
  readonly sourceTilesetId?: number;
  readonly sourceGameId?: number;
};

export type SlotCompositionLike = Readonly<
  Partial<Record<string, SlotSourceLike | null | undefined>>
>;

function slotHasCatalogProvenance(source: SlotSourceLike): boolean {
  return (
    (typeof source.sourceGameId === 'number' && Number.isFinite(source.sourceGameId)) ||
    (typeof source.sourceTilesetId === 'number' && Number.isFinite(source.sourceTilesetId))
  );
}

function filledSlotSources(slots: SlotCompositionLike): readonly SlotSourceLike[] {
  const filled: SlotSourceLike[] = [];
  for (const source of Object.values(slots)) {
    if (source == null || typeof source !== 'object') continue;
    if (typeof source.object === 'string' && source.object.length > 0) {
      filled.push(source);
    }
  }
  return filled;
}

/**
 * True when every non-empty tile slot looks catalog-sourced (has
 * `sourceGameId` and/or `sourceTilesetId`) and at least one such slot exists.
 *
 * Maker Studio v0 treats catalog-sourced slots as `import-rpgm` provenance for
 * the community gate (DESIGN hard rule). User-authored sheets that only carry
 * an `object` hash (no source ids) are not "imported". Empty maps → false.
 */
export function usesOnlyImportedSlotSources(slots: SlotCompositionLike): boolean {
  return licenseTagFromSlots(slots) === 'import-rpgm';
}

/**
 * Coarse license tag for DESIGN share payload:
 * - empty / all object-only → `user-owned`
 * - all catalog provenance → `import-rpgm`
 * - mix → `mixed`
 */
export function licenseTagFromSlots(slots: SlotCompositionLike): CommunityLicenseTag {
  const filled = filledSlotSources(slots);
  if (filled.length === 0) return 'user-owned';
  let imported = 0;
  for (const source of filled) {
    if (slotHasCatalogProvenance(source)) imported += 1;
  }
  if (imported === filled.length) return 'import-rpgm';
  if (imported === 0) return 'user-owned';
  return 'mixed';
}

/**
 * Build a share payload if settings allow. Returns null when the user opted out
 * or the imported-asset gate blocks the map. Network upload is intentionally
 * not implemented here.
 */
export function maybeEnqueueCommunityShare(
  settings: CommunitySettings,
  input: {
    readonly mapId: string;
    readonly mapName: string;
    readonly tileObjectShas: readonly string[];
    readonly usesOnlyImportedAssets: boolean;
    /** MapDocument.version (defaults to 0). */
    readonly version?: number;
    /** Defaults from usesOnlyImportedAssets when omitted. */
    readonly licenseTag?: CommunityLicenseTag;
    readonly now?: () => string;
  },
): CommunityShareEnqueue | null {
  if (!settings.shareOnSave) return null;
  if (input.usesOnlyImportedAssets && !settings.allowImportedAssets) return null;
  const version =
    typeof input.version === 'number' && Number.isFinite(input.version)
      ? Math.trunc(input.version)
      : 0;
  const licenseTag =
    input.licenseTag ??
    (input.usesOnlyImportedAssets ? 'import-rpgm' : 'user-owned');
  return {
    mapId: input.mapId,
    mapName: input.mapName,
    tileObjectShas: input.tileObjectShas,
    at: (input.now ?? (() => new Date().toISOString()))(),
    version,
    licenseTag,
  };
}
