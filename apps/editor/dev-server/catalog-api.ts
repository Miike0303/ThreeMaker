// Node-side helper for `vite.config.ts`'s dev-only catalog API middleware.
// Deliberately does NOT import `@threemaker/assets` (or any workspace TS
// package) -- Vite's config-file bundler treats node_modules-resolved
// packages as external and does not rewrite their internal `.js`-suffixed
// TS-source imports, which breaks at runtime with `ERR_MODULE_NOT_FOUND`.
// A plain relative import of this file, backed directly by `better-sqlite3`,
// sidesteps that entirely. This means the query shapes below are a SECOND
// duplicate of `packages/assets/src/catalog.ts`'s schema (the first
// duplicate is `apps/editor/src-tauri/src/catalog_ipc.rs`) -- see that
// file's module doc for the same schema-drift caveat.
import Database from 'better-sqlite3';

export interface DevGameRow {
  readonly id: number;
  readonly rootPath: string;
  readonly title: string | null;
  readonly engine: string;
  readonly scannedAt: string;
}

export interface DevAssetRow {
  readonly id: number;
  readonly gameId: number;
  readonly relPath: string;
  readonly type: string;
  readonly sha256: string;
  readonly wasEncrypted: boolean;
}

export interface DevAssetFilter {
  readonly gameId?: number;
  readonly type?: string;
}

export interface DevAssetPagination {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * MUST match `packages/assets/src/catalog.ts`'s `SCHEMA_VERSION` exactly
 * (and `apps/editor/src-tauri/src/catalog_ipc.rs`'s `EXPECTED_SCHEMA_VERSION`).
 * No cross-language sharing exists for this constant -- bump all three
 * together whenever the Node writer's schema changes in a way that affects
 * what a reader expects.
 */
export const EXPECTED_SCHEMA_VERSION = 1;

export class SchemaVersionMismatchError extends Error {
  constructor(actual: number) {
    super(
      `Catalog schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, found ${actual}. ` +
        `Re-run the bulk-scan CLI (packages/assets) to rebuild the catalog with the current schema.`,
    );
    this.name = 'SchemaVersionMismatchError';
  }
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Validates a sha256 hex digest before it's ever joined into a filesystem path (see `objectPath`). */
export function isValidSha256(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

/** Read-only handle used only by the dev catalog API middleware. */
export class DevCatalogReader {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
    const actualVersion = this.db.pragma('user_version', { simple: true }) as number;
    if (actualVersion !== EXPECTED_SCHEMA_VERSION) {
      this.db.close();
      throw new SchemaVersionMismatchError(actualVersion);
    }
  }

  close(): void {
    this.db.close();
  }

  listGames(): DevGameRow[] {
    return this.db
      .prepare(
        'SELECT id, root_path as rootPath, title, engine, scanned_at as scannedAt FROM games ORDER BY root_path',
      )
      .all() as DevGameRow[];
  }

  /**
   * Lists assets matching `filter`, optionally SQL-level `LIMIT`/`OFFSET`
   * paginated via `pagination` -- never loads the full filtered table into
   * Node memory just to slice it in JS. Pair with `countAssets(filter)` for
   * the total count.
   */
  listAssets(filter: DevAssetFilter = {}, pagination?: DevAssetPagination): DevAssetRow[] {
    const { where, params } = buildWhereClause(filter);
    let sql = `SELECT id, game_id as gameId, rel_path as relPath, type, sha256, was_encrypted as wasEncrypted FROM assets ${where} ORDER BY rel_path`;
    const allParams: (string | number)[] = [...params];
    if (pagination) {
      sql += ' LIMIT ? OFFSET ?';
      allParams.push(pagination.pageSize, pagination.page * pagination.pageSize);
    }
    const rows = this.db.prepare(sql).all(...allParams) as (Omit<DevAssetRow, 'wasEncrypted'> & {
      wasEncrypted: number;
    })[];
    return rows.map((row) => ({ ...row, wasEncrypted: row.wasEncrypted === 1 }));
  }

  /** `COUNT(*)` over the same filter `listAssets` would apply, without loading matching rows. */
  countAssets(filter: DevAssetFilter = {}): number {
    const { where, params } = buildWhereClause(filter);
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM assets ${where}`).get(...params) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  /** Throws for a non-hex/wrong-length `sha256` instead of ever joining an unvalidated path segment into a filesystem path. */
  objectPath(storeDir: string, sha256: string): string {
    if (!isValidSha256(sha256)) {
      throw new Error(`Invalid sha256 path segment: "${sha256}"`);
    }
    return `${storeDir}/objects/${sha256.slice(0, 2)}/${sha256}`;
  }
}

function buildWhereClause(filter: DevAssetFilter): {
  where: string;
  params: (string | number)[];
} {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.gameId !== undefined) {
    clauses.push('game_id = ?');
    params.push(filter.gameId);
  }
  if (filter.type !== undefined) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
