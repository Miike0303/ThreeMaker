//! Read-only Tauri IPC boundary onto the asset catalog SQLite database
//! produced by `packages/assets`' bulk-scan CLI (Node/better-sqlite3 writer).
//!
//! The webview never touches SQL directly (design's "Editor catalog read
//! path" decision: rusqlite + typed IPC commands, `tauri-plugin-sql`
//! rejected). This module owns the read-only `Connection` plus the query
//! functions; `lib.rs` only wires the three `#[tauri::command]` entry points
//! and the app-level `CatalogState`.
//!
//! The schema below is a deliberate DUPLICATE of
//! `packages/assets/src/catalog.ts`'s `SCHEMA_SQL` — there is no code sharing
//! between the Node catalog writer and this Rust reader across the process
//! boundary, so the two must be kept in sync by hand. Any future catalog
//! column change MUST be mirrored here or the editor will silently read
//! stale/missing columns. Flagged as a known drift risk (see apply-progress).

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

/// Matches `packages/assets/src/catalog.ts`'s `SCHEMA_SQL` table shapes
/// exactly (see module doc). Used only by this module's own tests to build a
/// fixture database identical in shape to a real bulk-run catalog.
#[cfg(test)]
pub(crate) const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  title TEXT,
  engine TEXT NOT NULL CHECK (engine IN ('mv','mz')),
  encryption_key TEXT,
  scanned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('png','ogg','m4a','other')),
  width INTEGER,
  height INTEGER
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  rel_path TEXT NOT NULL,
  type TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES objects(sha256),
  was_encrypted INTEGER NOT NULL,
  UNIQUE(game_id, rel_path)
);

CREATE TABLE IF NOT EXISTS tilesets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  rpgm_id INTEGER,
  name TEXT,
  flags TEXT
);

CREATE TABLE IF NOT EXISTS tileset_sheets (
  tileset_id INTEGER NOT NULL REFERENCES tilesets(id),
  slot TEXT NOT NULL CHECK (slot IN ('A1','A2','A3','A4','A5','B','C','D','E')),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  PRIMARY KEY (tileset_id, slot)
);

CREATE TABLE IF NOT EXISTS tile_semantics (
  tileset_id INTEGER NOT NULL REFERENCES tilesets(id),
  tile_id INTEGER NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('wall','door','window','furniture','none')),
  ext TEXT,
  PRIMARY KEY (tileset_id, tile_id)
);

CREATE TABLE IF NOT EXISTS scan_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id),
  rel_path TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_objects_kind ON objects(kind);
"#;

/// Fixed page size for `catalog_list_assets` — matches the design's
/// "Organization queries" requirement without exposing a caller-tunable knob
/// this slice has no UI for yet.
pub const PAGE_SIZE: u32 = 100;

/// MUST match `packages/assets/src/catalog.ts`'s `SCHEMA_VERSION` exactly
/// (and `apps/editor/dev-server/catalog-api.ts`'s `EXPECTED_SCHEMA_VERSION`).
/// No cross-language sharing exists for this constant — bump all three
/// together whenever the Node writer's `SCHEMA_SQL` changes in a way that
/// affects what a reader expects. See that constant's doc comment for the
/// full bump-discipline note.
pub const EXPECTED_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Serialize)]
pub struct GameRow {
    pub id: i64,
    pub root_path: String,
    pub title: Option<String>,
    pub engine: String,
    pub scanned_at: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct AssetFilter {
    pub game_id: Option<i64>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AssetRow {
    pub id: i64,
    pub game_id: i64,
    pub rel_path: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub sha256: String,
    pub was_encrypted: bool,
}

#[derive(Debug, Serialize)]
pub struct AssetPage {
    pub rows: Vec<AssetRow>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Serialize)]
pub struct TilesetSheetRow {
    pub slot: String,
    pub asset_id: i64,
    pub sha256: String,
    pub rel_path: String,
}

#[derive(Debug, Serialize)]
pub struct TilesetRow {
    pub id: i64,
    pub game_id: i64,
    pub rpgm_id: Option<i64>,
    pub name: Option<String>,
    pub flags: Option<String>,
    pub sheets: Vec<TilesetSheetRow>,
}

/// Localizable error payload — the frontend maps `code` to a translated
/// string (see `src/catalog-client.ts`); `NotFound` in particular drives the
/// graceful empty-state when a user has no catalog yet (bulk scan not run).
#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum CatalogError {
    NotFound,
    OpenFailed(String),
    QueryFailed(String),
    SchemaVersionMismatch(String),
}

impl From<rusqlite::Error> for CatalogError {
    fn from(err: rusqlite::Error) -> Self {
        CatalogError::QueryFailed(err.to_string())
    }
}

/// Resolves the default catalog db path (`~/.threemaker/asset-store/catalog.db`,
/// matching `packages/assets`' CLI default), overridable via
/// `THREEMAKER_CATALOG_DB_PATH` for tests/alternate stores.
pub fn resolve_catalog_db_path() -> PathBuf {
    if let Ok(override_path) = std::env::var("THREEMAKER_CATALOG_DB_PATH") {
        return PathBuf::from(override_path);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".threemaker")
        .join("asset-store")
        .join("catalog.db")
}

/// Opens `path` read-only. Missing file is reported as `NotFound` (not a
/// generic open error) so the frontend can show a localized "run a bulk scan
/// first" empty state instead of an opaque failure. Verifies the catalog's
/// schema version before returning it (see `verify_schema_version`) — a
/// mismatched version fails loudly rather than silently reading
/// stale/missing columns.
pub fn open_catalog_connection(path: &Path) -> Result<Connection, CatalogError> {
    if !path.exists() {
        return Err(CatalogError::NotFound);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| CatalogError::OpenFailed(err.to_string()))?;
    verify_schema_version(&conn)?;
    Ok(conn)
}

/// Asserts the open connection's `PRAGMA user_version` matches
/// `EXPECTED_SCHEMA_VERSION` exactly. This is the cheapest honest guard
/// against the Node writer (`packages/assets/src/catalog.ts`) and this Rust
/// reader drifting apart — there is no shared schema source between the two
/// languages (see this module's doc comment).
pub fn verify_schema_version(conn: &Connection) -> Result<(), CatalogError> {
    let actual: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|err| CatalogError::QueryFailed(err.to_string()))?;
    if actual != EXPECTED_SCHEMA_VERSION {
        return Err(CatalogError::SchemaVersionMismatch(format!(
            "catalog schema version mismatch: expected {EXPECTED_SCHEMA_VERSION}, found {actual}. \
             Re-run the bulk-scan CLI (packages/assets) to rebuild the catalog with the current schema."
        )));
    }
    Ok(())
}

pub fn list_games(conn: &Connection) -> Result<Vec<GameRow>, CatalogError> {
    let mut stmt = conn.prepare(
        "SELECT id, root_path, title, engine, scanned_at FROM games ORDER BY root_path",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(GameRow {
                id: row.get(0)?,
                root_path: row.get(1)?,
                title: row.get(2)?,
                engine: row.get(3)?,
                scanned_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn list_assets(
    conn: &Connection,
    filter: &AssetFilter,
    page: u32,
) -> Result<AssetPage, CatalogError> {
    let mut clauses: Vec<&str> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(game_id) = filter.game_id {
        clauses.push("game_id = ?");
        params.push(Box::new(game_id));
    }
    if let Some(type_) = &filter.type_ {
        clauses.push("type = ?");
        params.push(Box::new(type_.clone()));
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    let count_sql = format!("SELECT COUNT(*) FROM assets {where_clause}");
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn.query_row(&count_sql, param_refs.as_slice(), |row| row.get(0))?;

    let offset = i64::from(page) * i64::from(PAGE_SIZE);
    let list_sql = format!(
        "SELECT id, game_id, rel_path, type, sha256, was_encrypted FROM assets {where_clause} \
         ORDER BY rel_path LIMIT ? OFFSET ?"
    );
    let mut list_params = params;
    list_params.push(Box::new(i64::from(PAGE_SIZE)));
    list_params.push(Box::new(offset));
    let list_param_refs: Vec<&dyn rusqlite::ToSql> =
        list_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&list_sql)?;
    let rows = stmt
        .query_map(list_param_refs.as_slice(), |row| {
            Ok(AssetRow {
                id: row.get(0)?,
                game_id: row.get(1)?,
                rel_path: row.get(2)?,
                type_: row.get(3)?,
                sha256: row.get(4)?,
                was_encrypted: row.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(AssetPage {
        rows,
        total,
        page,
        page_size: PAGE_SIZE,
    })
}

pub fn get_tileset(conn: &Connection, id: i64) -> Result<Option<TilesetRow>, CatalogError> {
    let tileset = conn
        .query_row(
            "SELECT id, game_id, rpgm_id, name, flags FROM tilesets WHERE id = ?",
            [id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

    let Some((tileset_id, game_id, rpgm_id, name, flags)) = tileset else {
        return Ok(None);
    };

    let mut stmt = conn.prepare(
        "SELECT ts.slot, ts.asset_id, a.sha256, a.rel_path \
         FROM tileset_sheets ts JOIN assets a ON a.id = ts.asset_id \
         WHERE ts.tileset_id = ? ORDER BY ts.slot",
    )?;
    let sheets = stmt
        .query_map([tileset_id], |row| {
            Ok(TilesetSheetRow {
                slot: row.get(0)?,
                asset_id: row.get(1)?,
                sha256: row.get(2)?,
                rel_path: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Some(TilesetRow {
        id: tileset_id,
        game_id,
        rpgm_id,
        name,
        flags,
        sheets,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds an in-memory fixture db with the exact schema shape a real
    /// catalog has, plus a handful of rows spanning two games and both an
    /// image and audio asset, and one populated tileset (2 sheets) so
    /// `get_tileset` has a non-empty case to exercise.
    fn fixture_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA_SQL).expect("apply schema");
        conn.pragma_update(None, "user_version", EXPECTED_SCHEMA_VERSION)
            .expect("stamp schema version");

        conn.execute(
            "INSERT INTO games (root_path, title, engine, encryption_key, scanned_at) \
             VALUES ('/games/en/Foo', 'Foo', 'mz', NULL, '2026-07-11T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (root_path, title, engine, encryption_key, scanned_at) \
             VALUES ('/games/es/Foo-es', 'Foo-es', 'mv', NULL, '2026-07-11T00:00:01Z')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO objects (sha256, bytes, kind) VALUES ('sha-tileset-a', 100, 'png')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO objects (sha256, bytes, kind) VALUES ('sha-tileset-b', 200, 'png')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO objects (sha256, bytes, kind) VALUES ('sha-bgm', 50, 'ogg')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted) \
             VALUES (1, 'img/tilesets/Outside_A2.png', 'tileset', 'sha-tileset-a', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted) \
             VALUES (1, 'img/tilesets/Outside_B.png', 'tileset', 'sha-tileset-b', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted) \
             VALUES (1, 'audio/bgm/Field1.ogg', 'bgm', 'sha-bgm', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted) \
             VALUES (2, 'img/tilesets/Outside_A2.png', 'tileset', 'sha-tileset-a', 0)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tilesets (id, game_id, rpgm_id, name, flags) \
             VALUES (1, 1, 1, 'Outside', '[0]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tileset_sheets (tileset_id, slot, asset_id) VALUES (1, 'A2', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tileset_sheets (tileset_id, slot, asset_id) VALUES (1, 'B', 2)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn list_games_returns_all_games_ordered_by_root_path() {
        let conn = fixture_connection();
        let games = list_games(&conn).expect("list_games");
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].root_path, "/games/en/Foo");
        assert_eq!(games[1].root_path, "/games/es/Foo-es");
        assert_eq!(games[0].engine, "mz");
    }

    #[test]
    fn list_assets_filters_by_game_and_type() {
        let conn = fixture_connection();

        let by_type = list_assets(&conn, &AssetFilter { game_id: None, type_: Some("tileset".into()) }, 0)
            .expect("list_assets by type");
        assert_eq!(by_type.total, 3);
        assert_eq!(by_type.rows.len(), 3);
        assert!(by_type.rows.iter().all(|row| row.type_ == "tileset"));

        let by_game_and_type = list_assets(
            &conn,
            &AssetFilter { game_id: Some(1), type_: Some("bgm".into()) },
            0,
        )
        .expect("list_assets by game+type");
        assert_eq!(by_game_and_type.total, 1);
        assert_eq!(by_game_and_type.rows[0].rel_path, "audio/bgm/Field1.ogg");
        assert!(by_game_and_type.rows[0].was_encrypted);
    }

    #[test]
    fn list_assets_paginates() {
        let conn = fixture_connection();
        // 4 total assets seeded above; force a tiny page window via the
        // unfiltered query and PAGE_SIZE (100) still returns everything in
        // page 0 -- pagination correctness is instead verified by requesting
        // an out-of-range page and getting zero rows with the same total.
        let page0 = list_assets(&conn, &AssetFilter::default(), 0).expect("page 0");
        assert_eq!(page0.total, 4);
        assert_eq!(page0.rows.len(), 4);

        let page1 = list_assets(&conn, &AssetFilter::default(), 1).expect("page 1");
        assert_eq!(page1.total, 4);
        assert_eq!(page1.rows.len(), 0);
    }

    #[test]
    fn get_tileset_returns_sheets_joined_with_assets() {
        let conn = fixture_connection();
        let tileset = get_tileset(&conn, 1).expect("get_tileset").expect("tileset exists");
        assert_eq!(tileset.name.as_deref(), Some("Outside"));
        assert_eq!(tileset.sheets.len(), 2);
        assert_eq!(tileset.sheets[0].slot, "A2");
        assert_eq!(tileset.sheets[0].sha256, "sha-tileset-a");
        assert_eq!(tileset.sheets[1].slot, "B");
    }

    #[test]
    fn get_tileset_returns_none_for_unknown_id() {
        let conn = fixture_connection();
        let tileset = get_tileset(&conn, 999).expect("get_tileset");
        assert!(tileset.is_none());
    }

    #[test]
    fn open_catalog_connection_reports_not_found_for_missing_file() {
        let missing = Path::new("this/path/does/not/exist/catalog.db");
        let result = open_catalog_connection(missing);
        assert!(matches!(result, Err(CatalogError::NotFound)));
    }

    #[test]
    fn verify_schema_version_passes_for_the_matching_version() {
        let conn = fixture_connection();
        assert!(verify_schema_version(&conn).is_ok());
    }

    #[test]
    fn verify_schema_version_fails_loudly_for_a_mismatched_version() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA_SQL).expect("apply schema");
        conn.pragma_update(None, "user_version", 999i64)
            .expect("stamp a deliberately wrong schema version");

        let result = verify_schema_version(&conn);
        match result {
            Err(CatalogError::SchemaVersionMismatch(message)) => {
                assert!(message.contains("expected 1"));
                assert!(message.contains("found 999"));
            }
            other => panic!("expected SchemaVersionMismatch, got {other:?}"),
        }
    }
}
