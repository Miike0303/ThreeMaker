//! Native SQLite catalog writer for RPG Maker import — a Rust port of
//! `packages/assets/src/catalog.ts`'s `ingestGame` pipeline (slice A2).
//!
//! Opens/creates `store_dir/catalog.db` with the same pragmas and schema as
//! the Node writer, upserts `games`/`objects`/`assets` rows, and stores
//! decoded bytes via `import_scan::store_asset`. Source game folders are
//! read-only; all writes stay under `store_dir`.
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;

use crate::catalog_ipc::{verify_schema_version, EXPECTED_SCHEMA_VERSION, SCHEMA_SQL};
use crate::import_scan::{
    decode_asset_bytes, scan_games, store_asset, DecryptError, DecryptErrorCode, ImportScanError,
    RpgmEngine, ScanError, ScanErrorCode, ScanResult, ScannedGame,
};

const IMAGE_TYPE_MAP: &[(&str, &str)] = &[
    ("tilesets", "tileset"),
    ("parallaxes", "parallax"),
    ("pictures", "picture"),
    ("characters", "character"),
    ("faces", "face"),
    ("enemies", "enemy"),
    ("sv_actors", "sv_actor"),
    ("sv_enemies", "sv_enemy"),
    ("animations", "animation"),
    ("battlebacks1", "battleback1"),
    ("battlebacks2", "battleback2"),
    ("titles1", "title1"),
    ("titles2", "title2"),
    ("system", "system"),
];

const AUDIO_TYPE_MAP: &[(&str, &str)] =
    &[("bgm", "bgm"), ("bgs", "bgs"), ("me", "me"), ("se", "se")];

const DEFAULT_MAX_DEPTH: usize = 12;

const SHEET_NAME_ORDER: &[&str] = &["A1", "A2", "A3", "A4", "A5", "B", "C", "D", "E"];

const CANDIDATE_IMAGE_EXTENSIONS: &[&str] = &[".png", ".png_", ".rpgmvp"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestGameResult {
    pub game_id: i64,
    pub files_seen: u32,
    pub files_failed: u32,
    pub objects_created: u32,
    pub assets_linked: u32,
    pub bytes_scanned: u64,
    pub bytes_stored: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameImportFailure {
    pub root_path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub games_imported: usize,
    pub assets_stored: u32,
    pub assets_linked: u32,
    pub tilesets_ingested: u32,
    pub sheets_linked: u32,
    pub sheets_skipped: u32,
    pub scan_errors: Vec<ScanError>,
    pub game_failures: Vec<GameImportFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum ImportError {
    PathNotFound(String),
    PathNotDirectory(String),
    StoreFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCatalogSummary {
    pub games_imported: usize,
    pub assets_stored: u32,
    pub assets_linked: u32,
    pub game_failures: Vec<GameImportFailure>,
    pub scan_errors: Vec<ScanError>,
    pub failures_by_code: HashMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)]
pub enum CatalogWriteError {
    OpenFailed(String),
    SchemaFailed(String),
    QueryFailed(String),
}

impl std::fmt::Display for CatalogWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CatalogWriteError::OpenFailed(message) => write!(f, "open failed: {message}"),
            CatalogWriteError::SchemaFailed(message) => write!(f, "schema failed: {message}"),
            CatalogWriteError::QueryFailed(message) => write!(f, "query failed: {message}"),
        }
    }
}

impl std::error::Error for CatalogWriteError {}

/// Resolves `store_dir/catalog.db`, matching the Node CLI layout.
pub fn catalog_db_path(store_dir: &Path) -> PathBuf {
    store_dir.join("catalog.db")
}

/// Opens (or creates) the catalog database read-write with WAL, busy timeout,
/// schema creation, and schema-version stamp — mirroring `openCatalog` in TS.
pub fn open_catalog_for_write(store_dir: &Path) -> Result<Connection, CatalogWriteError> {
    let db_path = catalog_db_path(store_dir);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|err| CatalogWriteError::OpenFailed(err.to_string()))?;
    }

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|err| CatalogWriteError::OpenFailed(err.to_string()))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| CatalogWriteError::OpenFailed(err.to_string()))?;
    conn.pragma_update(None, "busy_timeout", 5000i64)
        .map_err(|err| CatalogWriteError::OpenFailed(err.to_string()))?;
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|err| CatalogWriteError::SchemaFailed(err.to_string()))?;
    conn.pragma_update(None, "user_version", EXPECTED_SCHEMA_VERSION)
        .map_err(|err| CatalogWriteError::SchemaFailed(err.to_string()))?;
    verify_schema_version(&conn)
        .map_err(|err| CatalogWriteError::SchemaFailed(format!("{err:?}")))?;

    Ok(conn)
}

/// Ingests one scanned game inside a single transaction. Per-asset failures are
/// recorded in `scan_errors` without aborting the rest of the game.
pub fn ingest_game(
    conn: &Connection,
    game: &ScannedGame,
    store_dir: &Path,
) -> Result<IngestGameResult, CatalogWriteError> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;

    let result = ingest_game_in_tx(&tx, game, store_dir)?;

    tx.commit()
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;

    Ok(result)
}

/// Scans and ingests every game in `scan_result` with per-game failure
/// isolation. Scan errors from discovery are persisted and echoed in the summary.
pub fn import_catalog(
    scan_result: &ScanResult,
    store_dir: &Path,
) -> Result<ImportCatalogSummary, CatalogWriteError> {
    let conn = open_catalog_for_write(store_dir)?;
    clear_null_scan_errors(&conn)?;
    let scan_error_baseline = max_scan_error_id(&conn)?;

    for error in &scan_result.errors {
        insert_scan_error(
            &conn,
            None,
            Some(error.path.display().to_string()),
            scan_error_code_str(&error.code),
            &error.message,
        )?;
    }

    let mut games_imported = 0usize;
    let mut assets_stored = 0u32;
    let mut assets_linked = 0u32;
    let mut game_failures = Vec::new();

    for game in &scan_result.games {
        match ingest_game(&conn, game, store_dir) {
            Ok(result) => {
                games_imported += 1;
                assets_stored += result.objects_created;
                assets_linked += result.assets_linked;
            }
            Err(err) => {
                let root_path = game.root_path.display().to_string();
                insert_scan_error(
                    &conn,
                    None,
                    Some(root_path.clone()),
                    "ingest-failed",
                    &err.to_string(),
                )?;
                game_failures.push(GameImportFailure {
                    root_path,
                    message: err.to_string(),
                });
            }
        }
    }

    let failures_by_code = build_failures_by_code(&conn, scan_error_baseline)
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;

    Ok(ImportCatalogSummary {
        games_imported,
        assets_stored,
        assets_linked,
        game_failures,
        scan_errors: scan_result.errors.clone(),
        failures_by_code,
    })
}

fn ingest_game_in_tx(
    conn: &Connection,
    game: &ScannedGame,
    store_dir: &Path,
) -> Result<IngestGameResult, CatalogWriteError> {
    let root_path = game.root_path.display().to_string();
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let game_title = resolve_game_title(game);
    let game_id = upsert_game(
        conn,
        &root_path,
        &game_title,
        engine_str(&game.engine),
        game.encryption_key.as_deref(),
        &scanned_at,
    )?;
    clear_scan_errors_for_game(conn, game_id)?;

    let asset_root = asset_root_for_game(game);
    let key_bytes = game
        .encryption_key
        .as_deref()
        .and_then(|hex| hex::decode(hex).ok());

    let mut files_seen = 0u32;
    let mut files_failed = 0u32;
    let mut objects_created = 0u32;
    let mut bytes_scanned = 0u64;
    let mut bytes_stored = 0u64;

    let mut ingest_one = |kind: AssetKind,
                          rel_path: &str,
                          dir_name: &str|
     -> Result<(), CatalogWriteError> {
        files_seen += 1;
        let full_path = asset_root
            .join(dir_name)
            .join(rel_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let catalog_rel_path = format!("{dir_name}/{rel_path}");

        let raw = match fs::read(&full_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                files_failed += 1;
                insert_scan_error(
                    conn,
                    Some(game_id),
                    Some(catalog_rel_path),
                    "read-error",
                    &err.to_string(),
                )?;
                return Ok(());
            }
        };
        bytes_scanned += raw.len() as u64;

        let decoded = match decode_asset_bytes(rel_path, &raw, key_bytes.as_deref()) {
            Ok(asset) => asset,
            Err(err) => {
                files_failed += 1;
                insert_scan_error(
                    conn,
                    Some(game_id),
                    Some(catalog_rel_path),
                    decrypt_error_code_str(&err),
                    &err.message,
                )?;
                return Ok(());
            }
        };

        let object_existed = object_exists(store_dir, &decoded.bytes);
        let sha256 = store_asset(store_dir, &decoded.bytes).map_err(|err| match err {
            ImportScanError::StoreFailed(message) => CatalogWriteError::QueryFailed(message),
            ImportScanError::RootNotFound(message) => CatalogWriteError::QueryFailed(message),
            ImportScanError::RootNotDirectory(message) => CatalogWriteError::QueryFailed(message),
        })?;
        if !object_existed {
            objects_created += 1;
            bytes_stored += decoded.bytes.len() as u64;
        }

        insert_object(
            conn,
            &sha256,
            decoded.bytes.len() as i64,
            classify_object_kind(kind, rel_path),
        )?;
        upsert_asset(
            conn,
            game_id,
            &catalog_rel_path,
            classify_asset_type(kind, rel_path),
            &sha256,
            decoded.was_encrypted,
        )?;

        Ok(())
    };

    for rel_path in &game.image_assets {
        ingest_one(AssetKind::Image, rel_path, "img")?;
    }
    for rel_path in &game.audio_assets {
        ingest_one(AssetKind::Audio, rel_path, "audio")?;
    }

    Ok(IngestGameResult {
        game_id,
        files_seen,
        files_failed,
        objects_created,
        assets_linked: files_seen - files_failed,
        bytes_scanned,
        bytes_stored,
    })
}

#[derive(Clone, Copy)]
enum AssetKind {
    Image,
    Audio,
}

fn asset_root_for_game(game: &ScannedGame) -> PathBuf {
    match game.engine {
        RpgmEngine::Mv => game.root_path.join("www"),
        RpgmEngine::Mz => game.root_path.clone(),
    }
}

fn engine_str(engine: &RpgmEngine) -> &'static str {
    match engine {
        RpgmEngine::Mv => "mv",
        RpgmEngine::Mz => "mz",
    }
}

fn classify_asset_type(kind: AssetKind, rel_path: &str) -> &'static str {
    let first_segment = rel_path
        .split('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let map = match kind {
        AssetKind::Image => IMAGE_TYPE_MAP,
        AssetKind::Audio => AUDIO_TYPE_MAP,
    };
    map.iter()
        .find(|(segment, _)| *segment == first_segment)
        .map(|(_, asset_type)| *asset_type)
        .unwrap_or("other")
}

fn classify_object_kind(kind: AssetKind, rel_path: &str) -> &'static str {
    if matches!(kind, AssetKind::Image) {
        return "png";
    }
    let ext = Path::new(rel_path)
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("ogg") | Some("rpgmvo") | Some("ogg_") => "ogg",
        Some("m4a") | Some("m4a_") => "m4a",
        _ => "other",
    }
}

fn object_exists(store_dir: &Path, bytes: &[u8]) -> bool {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let sha256 = hex::encode(digest);
    store_dir
        .join("objects")
        .join(&sha256[..2])
        .join(&sha256)
        .exists()
}

fn resolve_game_title(game: &ScannedGame) -> String {
    game.system_title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| game.folder_title.clone())
}

fn upsert_game(
    conn: &Connection,
    root_path: &str,
    title: &str,
    engine: &str,
    encryption_key: Option<&str>,
    scanned_at: &str,
) -> Result<i64, CatalogWriteError> {
    conn.query_row(
        "INSERT INTO games (root_path, title, engine, encryption_key, scanned_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(root_path) DO UPDATE SET
           title = excluded.title,
           engine = excluded.engine,
           encryption_key = excluded.encryption_key,
           scanned_at = excluded.scanned_at
         RETURNING id",
        rusqlite::params![root_path, title, engine, encryption_key, scanned_at],
        |row| row.get(0),
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))
}

fn insert_object(
    conn: &Connection,
    sha256: &str,
    bytes: i64,
    kind: &str,
) -> Result<(), CatalogWriteError> {
    conn.execute(
        "INSERT INTO objects (sha256, bytes, kind) VALUES (?1, ?2, ?3)
         ON CONFLICT(sha256) DO NOTHING",
        rusqlite::params![sha256, bytes, kind],
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn upsert_asset(
    conn: &Connection,
    game_id: i64,
    rel_path: &str,
    asset_type: &str,
    sha256: &str,
    was_encrypted: bool,
) -> Result<(), CatalogWriteError> {
    conn.execute(
        "INSERT INTO assets (game_id, rel_path, type, sha256, was_encrypted)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(game_id, rel_path) DO UPDATE SET
           type = excluded.type,
           sha256 = excluded.sha256,
           was_encrypted = excluded.was_encrypted",
        rusqlite::params![
            game_id,
            rel_path,
            asset_type,
            sha256,
            i64::from(was_encrypted)
        ],
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilesetIngestResult {
    pub tilesets_processed: u32,
    pub sheets_linked: u32,
    pub sheets_skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTileset {
    rpgm_id: i64,
    name: String,
    flags: Vec<i64>,
    sheet_names: HashMap<String, String>,
}

/// Populates `tilesets`/`tileset_sheets` for one already-ingested game by
/// re-reading `Tilesets.json`. Idempotent; missing sheet assets are soft
/// `scan_errors` rows, not hard failures.
pub fn ingest_tilesets_for_game(
    conn: &Connection,
    game: &ScannedGame,
    game_id: i64,
) -> Result<TilesetIngestResult, CatalogWriteError> {
    clear_tileset_scan_errors_for_game(conn, game_id)?;
    let tilesets_path = asset_root_for_game(game).join("data").join("Tilesets.json");
    if !tilesets_path.exists() {
        return Ok(TilesetIngestResult {
            tilesets_processed: 0,
            sheets_linked: 0,
            sheets_skipped: 0,
        });
    }

    let raw = fs::read_to_string(&tilesets_path)
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    let json_text = strip_bom(&raw);
    let json: Value = serde_json::from_str(json_text)
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    let tilesets = parse_tilesets(&json)?;
    let tilesets_processed = tilesets.len() as u32;

    let mut sheets_linked = 0u32;
    let mut sheets_skipped = 0u32;

    for tileset in tilesets {
        let flags_json = serde_json::to_string(&tileset.flags)
            .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
        let tileset_id = upsert_tileset(
            conn,
            game_id,
            tileset.rpgm_id,
            Some(&tileset.name),
            Some(&flags_json),
        )?;

        for slot in SHEET_NAME_ORDER {
            let Some(sheet_name) = tileset.sheet_names.get(*slot) else {
                continue;
            };
            if sheet_name.is_empty() {
                continue;
            }

            match resolve_sheet_asset(conn, game_id, sheet_name) {
                Some(asset_id) => {
                    upsert_tileset_sheet(conn, tileset_id, slot, asset_id)?;
                    sheets_linked += 1;
                }
                None => {
                    sheets_skipped += 1;
                    let rel_path = format!("img/tilesets/{sheet_name}");
                    insert_scan_error(
                        conn,
                        Some(game_id),
                        Some(rel_path),
                        "sheet-not-found",
                        &format!(
                            "tileset sheet '{sheet_name}' was named in Tilesets.json but no matching asset was cataloged"
                        ),
                    )?;
                }
            }
        }
    }

    Ok(TilesetIngestResult {
        tilesets_processed,
        sheets_linked,
        sheets_skipped,
    })
}

/// Full native import: scan, catalog ingest, tileset ingest — without holding
/// any app-level catalog read lock (callers reload that separately).
pub fn import_path(
    root: &Path,
    max_depth: Option<usize>,
    store_dir: &Path,
) -> Result<ImportSummary, ImportError> {
    validate_import_root(root)?;

    let depth = max_depth.unwrap_or(DEFAULT_MAX_DEPTH);
    let scan_result = scan_games(root, depth).map_err(|err| match err {
        ImportScanError::RootNotFound(message) => ImportError::PathNotFound(message),
        ImportScanError::RootNotDirectory(message) => ImportError::PathNotDirectory(message),
        ImportScanError::StoreFailed(message) => ImportError::StoreFailed(message),
    })?;

    let catalog_summary = import_catalog(&scan_result, store_dir)
        .map_err(|err| ImportError::StoreFailed(err.to_string()))?;

    let conn = open_catalog_for_write(store_dir)
        .map_err(|err| ImportError::StoreFailed(err.to_string()))?;

    let failed_roots: std::collections::HashSet<String> = catalog_summary
        .game_failures
        .iter()
        .map(|failure| failure.root_path.clone())
        .collect();
    let mut game_failures = catalog_summary.game_failures;

    let mut tilesets_ingested = 0u32;
    let mut sheets_linked = 0u32;
    let mut sheets_skipped = 0u32;

    for game in &scan_result.games {
        let root_path = game.root_path.display().to_string();
        if failed_roots.contains(&root_path) {
            continue;
        }

        let game_id: i64 = conn
            .query_row(
                "SELECT id FROM games WHERE root_path = ?1",
                [&root_path],
                |row| row.get(0),
            )
            .map_err(|err| ImportError::StoreFailed(err.to_string()))?;

        match ingest_tilesets_for_game(&conn, game, game_id) {
            Ok(tileset_result) => {
                tilesets_ingested += tileset_result.tilesets_processed;
                sheets_linked += tileset_result.sheets_linked;
                sheets_skipped += tileset_result.sheets_skipped;
            }
            Err(err) => {
                insert_scan_error(
                    &conn,
                    Some(game_id),
                    None,
                    "tileset-ingest-failed",
                    &err.to_string(),
                )
                .map_err(|e| ImportError::StoreFailed(e.to_string()))?;
                game_failures.push(GameImportFailure {
                    root_path,
                    message: err.to_string(),
                });
            }
        }
    }

    Ok(ImportSummary {
        games_imported: catalog_summary.games_imported,
        assets_stored: catalog_summary.assets_stored,
        assets_linked: catalog_summary.assets_linked,
        tilesets_ingested,
        sheets_linked,
        sheets_skipped,
        scan_errors: catalog_summary.scan_errors,
        game_failures,
    })
}

fn validate_import_root(root: &Path) -> Result<(), ImportError> {
    if !root.exists() {
        return Err(ImportError::PathNotFound(format!(
            "import path does not exist: {}",
            root.display()
        )));
    }
    if !root.is_dir() {
        return Err(ImportError::PathNotDirectory(format!(
            "import path is not a directory: {}",
            root.display()
        )));
    }
    Ok(())
}

fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

fn parse_tilesets(json: &Value) -> Result<Vec<ParsedTileset>, CatalogWriteError> {
    let entries = json.as_array().ok_or_else(|| {
        CatalogWriteError::QueryFailed("Invalid Tilesets.json: expected an array.".into())
    })?;

    let mut tilesets = Vec::new();
    for entry in entries {
        if entry.is_null() {
            continue;
        }
        let obj = entry.as_object().ok_or_else(|| {
            CatalogWriteError::QueryFailed(format!(
                "Invalid Tilesets.json entry: expected an object, got {entry}"
            ))
        })?;

        let rpgm_id = obj
            .get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| CatalogWriteError::QueryFailed("missing tileset id".into()))?;
        let name = obj
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CatalogWriteError::QueryFailed(format!("missing tileset name for id {rpgm_id}"))
            })?
            .to_string();

        let flags = obj
            .get("flags")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CatalogWriteError::QueryFailed(format!(
                    "Invalid Tilesets.json entry {rpgm_id}: flags must be an array of numbers"
                ))
            })?
            .iter()
            .map(|value| {
                value.as_i64().ok_or_else(|| {
                    CatalogWriteError::QueryFailed(format!(
                        "Invalid Tilesets.json entry {rpgm_id}: flags must be an array of numbers"
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let tileset_names = obj
            .get("tilesetNames")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CatalogWriteError::QueryFailed(format!(
                    "Invalid Tilesets.json entry {rpgm_id}: tilesetNames must have exactly {} entries",
                    SHEET_NAME_ORDER.len()
                ))
            })?;
        if tileset_names.len() != SHEET_NAME_ORDER.len() {
            return Err(CatalogWriteError::QueryFailed(format!(
                "Invalid Tilesets.json entry {rpgm_id}: tilesetNames must have exactly {} entries",
                SHEET_NAME_ORDER.len()
            )));
        }
        if !tileset_names.iter().all(|value| value.is_string()) {
            return Err(CatalogWriteError::QueryFailed(format!(
                "Invalid Tilesets.json entry {rpgm_id}: tilesetNames must contain only strings"
            )));
        }

        let mut sheet_names = HashMap::new();
        for (index, slot) in SHEET_NAME_ORDER.iter().enumerate() {
            let sheet_name = tileset_names[index]
                .as_str()
                .unwrap_or_default()
                .to_string();
            sheet_names.insert((*slot).to_string(), sheet_name);
        }

        tilesets.push(ParsedTileset {
            rpgm_id,
            name,
            flags,
            sheet_names,
        });
    }

    Ok(tilesets)
}

fn resolve_sheet_asset(conn: &Connection, game_id: i64, sheet_name: &str) -> Option<i64> {
    for extension in CANDIDATE_IMAGE_EXTENSIONS {
        let rel_path = format!("img/tilesets/{sheet_name}{extension}");
        if let Ok(asset_id) = conn.query_row(
            "SELECT id FROM assets WHERE game_id = ?1 AND rel_path = ?2 COLLATE NOCASE",
            rusqlite::params![game_id, rel_path],
            |row| row.get(0),
        ) {
            return Some(asset_id);
        }
    }
    None
}

fn upsert_tileset(
    conn: &Connection,
    game_id: i64,
    rpgm_id: i64,
    name: Option<&str>,
    flags: Option<&str>,
) -> Result<i64, CatalogWriteError> {
    if let Ok(existing_id) = conn.query_row(
        "SELECT id FROM tilesets WHERE game_id = ?1 AND rpgm_id IS ?2",
        rusqlite::params![game_id, rpgm_id],
        |row| row.get::<_, i64>(0),
    ) {
        conn.execute(
            "UPDATE tilesets SET name = ?1, flags = ?2 WHERE id = ?3",
            rusqlite::params![name, flags, existing_id],
        )
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
        return Ok(existing_id);
    }

    conn.query_row(
        "INSERT INTO tilesets (game_id, rpgm_id, name, flags) VALUES (?1, ?2, ?3, ?4) RETURNING id",
        rusqlite::params![game_id, rpgm_id, name, flags],
        |row| row.get(0),
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))
}

fn upsert_tileset_sheet(
    conn: &Connection,
    tileset_id: i64,
    slot: &str,
    asset_id: i64,
) -> Result<(), CatalogWriteError> {
    conn.execute(
        "INSERT INTO tileset_sheets (tileset_id, slot, asset_id) VALUES (?1, ?2, ?3)
         ON CONFLICT(tileset_id, slot) DO UPDATE SET asset_id = excluded.asset_id",
        rusqlite::params![tileset_id, slot, asset_id],
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn clear_null_scan_errors(conn: &Connection) -> Result<(), CatalogWriteError> {
    conn.execute("DELETE FROM scan_errors WHERE game_id IS NULL", [])
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn clear_scan_errors_for_game(conn: &Connection, game_id: i64) -> Result<(), CatalogWriteError> {
    conn.execute("DELETE FROM scan_errors WHERE game_id = ?1", [game_id])
        .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn clear_tileset_scan_errors_for_game(
    conn: &Connection,
    game_id: i64,
) -> Result<(), CatalogWriteError> {
    conn.execute(
"DELETE FROM scan_errors WHERE game_id = ?1 AND code IN ('sheet-not-found', 'tileset-ingest-failed')",
[game_id],
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn insert_scan_error(
    conn: &Connection,
    game_id: Option<i64>,
    rel_path: Option<String>,
    code: &str,
    message: &str,
) -> Result<(), CatalogWriteError> {
    conn.execute(
        "INSERT INTO scan_errors (game_id, rel_path, code, message) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![game_id, rel_path, code, message],
    )
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))?;
    Ok(())
}

fn max_scan_error_id(conn: &Connection) -> Result<i64, CatalogWriteError> {
    conn.query_row("SELECT COALESCE(MAX(id), 0) FROM scan_errors", [], |row| {
        row.get(0)
    })
    .map_err(|err| CatalogWriteError::QueryFailed(err.to_string()))
}

fn build_failures_by_code(
    conn: &Connection,
    baseline_id: i64,
) -> Result<HashMap<String, u32>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT code FROM scan_errors WHERE id > ?1")?;
    let rows = stmt.query_map([baseline_id], |row| row.get::<_, String>(0))?;
    let mut counts = HashMap::new();
    for code in rows.flatten() {
        *counts.entry(code).or_insert(0) += 1;
    }
    Ok(counts)
}

fn scan_error_code_str(code: &ScanErrorCode) -> &'static str {
    match code {
        ScanErrorCode::InvalidSystemJson => "invalid-system-json",
        ScanErrorCode::ReadError => "read-error",
        ScanErrorCode::DepthExceeded => "depth-exceeded",
        ScanErrorCode::CycleDetected => "cycle-detected",
    }
}

fn decrypt_error_code_str(err: &DecryptError) -> &'static str {
    match err.code {
        DecryptErrorCode::BadHeader => "bad-header",
        DecryptErrorCode::Truncated => "truncated",
        DecryptErrorCode::BadKey => "bad-key",
        DecryptErrorCode::MagicMismatch => "magic-mismatch",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_scan::{normalize_root_path, scan_games};
    use tempfile::TempDir;

    const VALID_SYSTEM_JSON: &str = r#"{"gameTitle":"Test Game","hasEncryptedImages":false}"#;

    fn write_system_json(data_dir: &Path, contents: &str) {
        fs::create_dir_all(data_dir).expect("create data dir");
        fs::write(data_dir.join("System.json"), contents).expect("write System.json");
    }

    fn tiny_png() -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        bytes.extend_from_slice(&[0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
        bytes
    }

    #[test]
    fn open_catalog_for_write_applies_wal_busy_timeout_and_schema_version() {
        let work = TempDir::new().expect("tempdir");
        let conn = open_catalog_for_write(work.path()).expect("open writer");

        let journal_mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal_mode");
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");

        let busy_timeout: i64 = conn
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("busy_timeout");
        assert_eq!(busy_timeout, 5000);

        let user_version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version");
        assert_eq!(user_version, EXPECTED_SCHEMA_VERSION);
    }

    #[test]
    fn ingest_game_upserts_system_title_when_present() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Folder Name");
        write_system_json(
            &game_root.join("data"),
            r#"{"gameTitle":"Display Title","hasEncryptedImages":false}"#,
        );
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let scan = scan_games(work.path(), 12).expect("scan");
        let game = &scan.games[0];
        let conn = open_catalog_for_write(work.path()).expect("open");
        ingest_game(&conn, game, work.path()).expect("ingest");

        let title: String = conn
            .query_row(
                "SELECT title FROM games WHERE root_path = ?1",
                [game.root_path.display().to_string()],
                |row| row.get(0),
            )
            .expect("title row");
        assert_eq!(title, "Display Title");
    }

    #[test]
    fn ingest_game_falls_back_to_folder_title_when_system_title_missing_or_empty() {
        let work = TempDir::new().expect("tempdir");

        let missing_root = work.path().join("Folder Name");
        write_system_json(
            &missing_root.join("data"),
            r#"{"hasEncryptedImages":false}"#,
        );
        fs::create_dir_all(missing_root.join("img/tilesets")).expect("img dir");
        fs::write(missing_root.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let scan = scan_games(work.path(), 12).expect("scan missing title");
        let conn = open_catalog_for_write(work.path()).expect("open");
        ingest_game(&conn, &scan.games[0], work.path()).expect("ingest missing title");
        let title: String = conn
            .query_row(
                "SELECT title FROM games WHERE root_path = ?1",
                [scan.games[0].root_path.display().to_string()],
                |row| row.get(0),
            )
            .expect("missing title row");
        assert_eq!(title, "Folder Name");

        let empty_root = work.path().join("Whitespace Title");
        write_system_json(
            &empty_root.join("data"),
            r#"{"gameTitle":"   ","hasEncryptedImages":false}"#,
        );
        fs::create_dir_all(empty_root.join("img/tilesets")).expect("img dir");
        fs::write(empty_root.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let scan2 = scan_games(work.path(), 12).expect("scan empty title");
        let empty_game = scan2
            .games
            .iter()
            .find(|game| game.root_path.ends_with("Whitespace Title"))
            .expect("empty-title game");
        ingest_game(&conn, empty_game, work.path()).expect("ingest empty title");
        let empty_title: String = conn
            .query_row(
                "SELECT title FROM games WHERE root_path = ?1",
                [empty_game.root_path.display().to_string()],
                |row| row.get(0),
            )
            .expect("empty title row");
        assert_eq!(empty_title, "Whitespace Title");
    }

    #[test]
    fn persisted_root_path_has_no_windows_verbatim_prefix() {
        let normalized = normalize_root_path(Path::new(r"\\?\C:\games\mv-game"));
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("mv-game");
        write_system_json(&game_root.join("www/data"), VALID_SYSTEM_JSON);

        let game = ScannedGame {
            root_path: normalized.clone(),
            engine: RpgmEngine::Mv,
            folder_title: "mv-game".into(),
            system_title: Some("Test Game".into()),
            has_encrypted_images: false,
            has_encrypted_audio: false,
            encryption_key: None,
            image_assets: vec![],
            audio_assets: vec![],
        };

        let conn = open_catalog_for_write(work.path()).expect("open");
        ingest_game(&conn, &game, work.path()).expect("ingest");

        let stored: String = conn
            .query_row("SELECT root_path FROM games", [], |row| row.get(0))
            .expect("root_path");
        assert!(!stored.starts_with(r"\\?\"));
        assert_eq!(stored, normalized.display().to_string());
    }

    #[test]
    fn reimport_reports_assets_linked_without_new_objects() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let scan = scan_games(work.path(), 12).expect("scan");
        let game = scan.games[0].clone();
        let conn = open_catalog_for_write(work.path()).expect("open");

        let first = ingest_game(&conn, &game, work.path()).expect("first ingest");
        assert!(first.objects_created > 0);
        assert_eq!(first.assets_linked, 1);

        let second = ingest_game(&conn, &game, work.path()).expect("second ingest");
        assert_eq!(second.objects_created, 0);
        assert_eq!(second.assets_linked, 1);

        let scan2 = scan_games(work.path(), 12).expect("rescan");
        let summary = import_catalog(&scan2, work.path()).expect("import");
        assert_eq!(summary.games_imported, 1);
        assert_eq!(summary.assets_stored, 0);
        assert_eq!(summary.assets_linked, 1);
    }

    #[test]
    fn reimporting_same_folder_yields_one_games_row() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let scan = scan_games(work.path(), 12).expect("scan");
        let game = scan.games[0].clone();
        let conn = open_catalog_for_write(work.path()).expect("open");

        let first = ingest_game(&conn, &game, work.path()).expect("first ingest");
        let second = ingest_game(&conn, &game, work.path()).expect("second ingest");
        assert_eq!(second.game_id, first.game_id);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn reimport_after_asset_change_updates_sha256() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        let png_path = game_root.join("img/tilesets/A.png");

        fs::write(&png_path, tiny_png()).expect("png v1");
        let scan = scan_games(work.path(), 12).expect("scan");
        let game = scan.games[0].clone();
        let conn = open_catalog_for_write(work.path()).expect("open");
        ingest_game(&conn, &game, work.path()).expect("first ingest");

        let first_sha: String = conn
            .query_row(
                "SELECT sha256 FROM assets WHERE rel_path = 'img/tilesets/A.png'",
                [],
                |row| row.get(0),
            )
            .expect("first sha");

        let mut updated = tiny_png();
        updated.push(0xff);
        fs::write(&png_path, &updated).expect("png v2");
        let scan2 = scan_games(work.path(), 12).expect("rescan");
        ingest_game(&conn, &scan2.games[0], work.path()).expect("second ingest");

        let second_sha: String = conn
            .query_row(
                "SELECT sha256 FROM assets WHERE rel_path = 'img/tilesets/A.png'",
                [],
                |row| row.get(0),
            )
            .expect("second sha");
        assert_ne!(first_sha, second_sha);
    }

    #[test]
    fn per_asset_decrypt_failure_does_not_abort_game_ingest() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/Bad.png_"), b"not-encrypted").expect("bad asset");
        fs::write(game_root.join("img/tilesets/Good.png"), tiny_png()).expect("good asset");

        let scan = scan_games(work.path(), 12).expect("scan");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let result = ingest_game(&conn, &scan.games[0], work.path()).expect("ingest");

        assert_eq!(result.files_failed, 1);
        let asset_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
            .expect("assets");
        assert_eq!(asset_count, 1);
    }

    #[test]
    fn reimport_keeps_scan_error_counts_stable_for_asset_and_tileset_failures() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/Bad.png_"), b"not-encrypted").expect("bad asset");
        fs::write(game_root.join("img/tilesets/Outside_A2.png"), tiny_png()).expect("a2 png");
        fs::write(game_root.join("data/Tilesets.json"), make_tilesets_json()).expect("tilesets");

        let first = import_path(work.path(), Some(12), work.path()).expect("first import");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let first_errors: i64 = conn
            .query_row("SELECT COUNT(*) FROM scan_errors", [], |row| row.get(0))
            .expect("count errors");
        assert!(
            first_errors > 0,
            "expected scan errors from bad asset and missing sheet"
        );

        let second = import_path(work.path(), Some(12), work.path()).expect("second import");
        let second_errors: i64 = conn
            .query_row("SELECT COUNT(*) FROM scan_errors", [], |row| row.get(0))
            .expect("count errors");
        assert_eq!(
            first_errors, second_errors,
            "reimport must not accumulate duplicate scan_errors rows"
        );
        assert_eq!(first.games_imported, 1);
        assert_eq!(second.games_imported, 1);
    }

    #[test]
    fn fixed_asset_reingest_clears_prior_scan_error() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        let bad_path = game_root.join("img/tilesets/Bad.png_");
        fs::write(&bad_path, b"not-encrypted").expect("bad asset");

        let scan = scan_games(work.path(), 12).expect("scan");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let first = ingest_game(&conn, &scan.games[0], work.path()).expect("first ingest");
        assert_eq!(first.files_failed, 1);
        let errors_after_bad: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scan_errors WHERE game_id = ?1",
                [first.game_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(errors_after_bad, 1);

        fs::remove_file(&bad_path).expect("remove bad asset");
        fs::write(game_root.join("img/tilesets/Good.png"), tiny_png()).expect("good asset");
        let scan2 = scan_games(work.path(), 12).expect("rescan");
        let second = ingest_game(&conn, &scan2.games[0], work.path()).expect("second ingest");
        assert_eq!(second.files_failed, 0);
        let errors_after_fix: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scan_errors WHERE game_id = ?1",
                [second.game_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(errors_after_fix, 0);
    }

    #[test]
    fn import_catalog_carries_scan_errors_and_imports_multiple_games() {
        let work = TempDir::new().expect("tempdir");

        let good_a = work.path().join("good-a");
        write_system_json(&good_a.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(good_a.join("img/tilesets")).expect("img");
        fs::write(good_a.join("img/tilesets/A.png"), tiny_png()).expect("png");

        let broken = work.path().join("broken");
        write_system_json(&broken.join("data"), "{ not json ");

        let good_c = work.path().join("good-c");
        write_system_json(&good_c.join("data"), VALID_SYSTEM_JSON);

        let scan = scan_games(work.path(), 12).expect("scan");
        assert_eq!(scan.games.len(), 2);
        assert_eq!(scan.errors.len(), 1);

        let summary = import_catalog(&scan, work.path()).expect("import");
        assert_eq!(summary.games_imported, 2);
        assert_eq!(summary.scan_errors.len(), 1);
        assert!(summary.game_failures.is_empty());
        assert!(summary.failures_by_code.contains_key("invalid-system-json"));
    }

    fn make_tilesets_json() -> String {
        serde_json::to_string(&serde_json::json!([
            null,
            {
                "id": 1,
                "name": "Outside",
                "tilesetNames": ["", "Outside_A2", "", "", "", "Outside_B", "", "", ""],
                "flags": vec![0i64; 8192]
            }
        ]))
        .expect("tilesets json")
    }

    fn seed_tileset_fixture(work: &TempDir) -> PathBuf {
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/Outside_A2.png"), tiny_png()).expect("a2 png");
        fs::write(game_root.join("img/tilesets/Outside_B.png"), tiny_png()).expect("b png");
        fs::write(game_root.join("data/Tilesets.json"), make_tilesets_json())
            .expect("tilesets json");
        game_root
    }

    #[test]
    fn ingest_tilesets_writes_tilesets_and_sheets_readable_by_get_tileset() {
        let work = TempDir::new().expect("tempdir");
        seed_tileset_fixture(&work);

        let scan = scan_games(work.path(), 12).expect("scan");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let ingest = ingest_game(&conn, &scan.games[0], work.path()).expect("ingest");
        let tileset_result =
            ingest_tilesets_for_game(&conn, &scan.games[0], ingest.game_id).expect("tilesets");
        assert_eq!(tileset_result.tilesets_processed, 1);
        assert_eq!(tileset_result.sheets_linked, 2);

        let summaries = crate::catalog_ipc::list_tilesets_for_game(&conn, ingest.game_id)
            .expect("list tilesets");
        assert_eq!(summaries.len(), 1);

        let tileset = crate::catalog_ipc::get_tileset(&conn, summaries[0].id)
            .expect("get tileset")
            .expect("tileset exists");
        assert_eq!(tileset.name.as_deref(), Some("Outside"));
        assert_eq!(tileset.sheets.len(), 2);
        let slots: Vec<&str> = tileset
            .sheets
            .iter()
            .map(|sheet| sheet.slot.as_str())
            .collect();
        assert!(slots.contains(&"A2"));
        assert!(slots.contains(&"B"));
    }

    #[test]
    fn ingest_tilesets_resolves_case_mismatched_sheet_filename() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/A1.png"), tiny_png()).expect("a1 png");
        let tilesets_json = serde_json::to_string(&serde_json::json!([
            null,
            {
                "id": 1,
                "name": "Water",
                "tilesetNames": ["a1", "", "", "", "", "", "", "", ""],
                "flags": vec![0i64; 8192]
            }
        ]))
        .expect("json");
        fs::write(game_root.join("data/Tilesets.json"), tilesets_json).expect("tilesets");

        let scan = scan_games(work.path(), 12).expect("scan");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let ingest = ingest_game(&conn, &scan.games[0], work.path()).expect("ingest");
        let result =
            ingest_tilesets_for_game(&conn, &scan.games[0], ingest.game_id).expect("tilesets");
        assert_eq!(result.sheets_linked, 1);

        let tileset_id =
            crate::catalog_ipc::list_tilesets_for_game(&conn, ingest.game_id).expect("list")[0].id;
        let tileset = crate::catalog_ipc::get_tileset(&conn, tileset_id)
            .expect("get")
            .expect("exists");
        assert_eq!(tileset.sheets[0].slot, "A1");
        assert_eq!(tileset.sheets[0].rel_path, "img/tilesets/A1.png");
    }

    #[test]
    fn missing_sheet_asset_records_scan_error_and_links_other_slots() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("Game");
        write_system_json(&game_root.join("data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(game_root.join("img/tilesets")).expect("img dir");
        fs::write(game_root.join("img/tilesets/Outside_A2.png"), tiny_png()).expect("a2");
        fs::write(game_root.join("data/Tilesets.json"), make_tilesets_json()).expect("tilesets");

        let scan = scan_games(work.path(), 12).expect("scan");
        let conn = open_catalog_for_write(work.path()).expect("open");
        let ingest = ingest_game(&conn, &scan.games[0], work.path()).expect("ingest");
        let result =
            ingest_tilesets_for_game(&conn, &scan.games[0], ingest.game_id).expect("tilesets");
        assert_eq!(result.sheets_linked, 1);
        assert_eq!(result.sheets_skipped, 1);

        let error_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scan_errors WHERE code = 'sheet-not-found'",
                [],
                |row| row.get(0),
            )
            .expect("errors");
        assert_eq!(error_count, 1);

        let tileset_id =
            crate::catalog_ipc::list_tilesets_for_game(&conn, ingest.game_id).expect("list")[0].id;
        let tileset = crate::catalog_ipc::get_tileset(&conn, tileset_id)
            .expect("get")
            .expect("exists");
        assert_eq!(tileset.sheets.len(), 1);
        assert_eq!(tileset.sheets[0].slot, "A2");
    }

    #[test]
    fn import_path_is_idempotent_for_games_tilesets_and_sheets() {
        let work = TempDir::new().expect("tempdir");
        seed_tileset_fixture(&work);

        let first = import_path(work.path(), Some(12), work.path()).expect("first import");
        let second = import_path(work.path(), Some(12), work.path()).expect("second import");
        assert_eq!(first.games_imported, 1);
        assert_eq!(second.games_imported, 1);
        assert_eq!(first.tilesets_ingested, 1);
        assert_eq!(second.tilesets_ingested, 1);

        let conn = open_catalog_for_write(work.path()).expect("open");
        let games: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
            .expect("games");
        let tilesets: i64 = conn
            .query_row("SELECT COUNT(*) FROM tilesets", [], |row| row.get(0))
            .expect("tilesets");
        let sheets: i64 = conn
            .query_row("SELECT COUNT(*) FROM tileset_sheets", [], |row| row.get(0))
            .expect("sheets");
        assert_eq!(games, 1);
        assert_eq!(tilesets, 1);
        assert_eq!(sheets, 2);
    }

    #[test]
    fn import_path_reports_typed_errors_for_bad_paths() {
        let work = TempDir::new().expect("tempdir");
        let missing = work.path().join("does-not-exist");
        let err = import_path(&missing, None, work.path()).expect_err("missing");
        assert!(matches!(err, ImportError::PathNotFound(_)));

        let file_path = work.path().join("file.txt");
        fs::write(&file_path, b"x").expect("file");
        let err = import_path(&file_path, None, work.path()).expect_err("file");
        assert!(matches!(err, ImportError::PathNotDirectory(_)));
    }

    #[test]
    fn import_summary_and_error_serialize_camel_case() {
        let summary = ImportSummary {
            games_imported: 2,
            assets_stored: 5,
            assets_linked: 12,
            tilesets_ingested: 3,
            sheets_linked: 4,
            sheets_skipped: 1,
            scan_errors: vec![],
            game_failures: vec![GameImportFailure {
                root_path: "/games/foo".into(),
                message: "failed".into(),
            }],
        };
        let json: serde_json::Value = serde_json::to_value(summary).expect("summary");
        assert_eq!(json["gamesImported"], 2);
        assert_eq!(json["assetsStored"], 5);
        assert_eq!(json["assetsLinked"], 12);
        assert_eq!(json["tilesetsIngested"], 3);
        assert_eq!(json["gameFailures"][0]["rootPath"], "/games/foo");
        assert!(json.get("games_imported").is_none());

        let err = ImportError::PathNotFound("missing".into());
        let err_json: serde_json::Value = serde_json::to_value(err).expect("error");
        assert_eq!(err_json["code"], "PathNotFound");
        assert_eq!(err_json["message"], "missing");
    }
}
