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

/** Read-only handle used only by the dev catalog API middleware. */
export class DevCatalogReader {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
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

  listAssets(filter: DevAssetFilter = {}): DevAssetRow[] {
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
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT id, game_id as gameId, rel_path as relPath, type, sha256, was_encrypted as wasEncrypted FROM assets ${where} ORDER BY rel_path`,
      )
      .all(...params) as (Omit<DevAssetRow, 'wasEncrypted'> & { wasEncrypted: number })[];
    return rows.map((row) => ({ ...row, wasEncrypted: row.wasEncrypted === 1 }));
  }

  objectPath(storeDir: string, sha256: string): string {
    return `${storeDir}/objects/${sha256.slice(0, 2)}/${sha256}`;
  }
}
