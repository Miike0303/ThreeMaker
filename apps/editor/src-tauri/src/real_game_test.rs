//! Opt-in integration coverage against a real RPG Maker installation.
//!
//! The test is env-gated instead of `#[ignore]` so an ordinary `cargo test`
//! visibly explains why no machine-local game was imported.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use rusqlite::{Connection, OptionalExtension};

use crate::import_catalog::{import_path, open_catalog_for_write};
use crate::import_scan::normalize_root_path;

const REAL_GAME_ENV: &str = "THREEMAKER_REAL_GAME_DIR";
const NON_TRIVIAL_ASSET_COUNT: i64 = 10;
const PATHOLOGICAL_ASSET_BYTES: i64 = 100 * 1024 * 1024;
const TILESET_SLOTS: &[&str] = &["A1", "A2", "A3", "A4", "A5", "B", "C", "D", "E"];

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceEntry {
    bytes: u64,
    modified: Option<SystemTime>,
    kind: SourceEntryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceEntryKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CatalogCounts {
    games: i64,
    assets: i64,
    objects: i64,
    tilesets: i64,
    sheets: i64,
    scan_errors: i64,
    total_bytes: i64,
}

#[derive(Debug)]
struct ScanErrorExample {
    code: String,
    rel_path: Option<String>,
    message: String,
}

#[test]
fn real_game_imports_read_only_and_is_idempotent() {
    let Some(source_dir) = std::env::var_os(REAL_GAME_ENV).map(PathBuf::from) else {
        eprintln!(
            "skipping real_game_imports_read_only_and_is_idempotent: \
             set {REAL_GAME_ENV} to a real RPG Maker MV/MZ game directory"
        );
        return;
    };

    assert!(
        source_dir.is_dir(),
        "{REAL_GAME_ENV} is not a directory: {}",
        source_dir.display()
    );

    let (expected_engine, system_json_path) = expected_engine_and_system_json(&source_dir);
    let expected_title = source_dir
        .file_name()
        .expect("real game path must have a folder basename")
        .to_string_lossy()
        .into_owned();
    let expected_root = normalize_root_path(
        &fs::canonicalize(&source_dir).expect("canonicalize real game directory"),
    )
    .display()
    .to_string();
    let expected_encryption_key = encryption_key_from_system_json(&system_json_path);
    let source_before = snapshot_source(&source_dir);
    let store = tempfile::tempdir().expect("create temporary asset store");

    let first_started = Instant::now();
    let first_result = import_path(&source_dir, None, store.path());
    let first_elapsed = first_started.elapsed();
    let first_counts = open_catalog_for_write(store.path())
        .ok()
        .map(|conn| catalog_counts(&conn));

    let second_started = Instant::now();
    let second_result = import_path(&source_dir, None, store.path());
    let second_elapsed = second_started.elapsed();
    let source_after = snapshot_source(&source_dir);

    let first = first_result.expect("first real-game import");
    let second = second_result.expect("second real-game import");
    let conn = open_catalog_for_write(store.path()).expect("open imported catalog");
    let first_counts = first_counts.expect("catalog must exist after first import");
    let second_counts = catalog_counts(&conn);
    let scan_errors_by_code = scan_error_counts(&conn);
    let scan_error_examples = scan_error_examples(&conn, 5);
    let (largest_asset_path, largest_asset_bytes) = largest_asset(&conn);
    let encrypted_assets: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assets WHERE was_encrypted != 0",
            [],
            |row| row.get(0),
        )
        .expect("count encrypted assets");

    println!(
        "REAL_GAME_SUMMARY games={} assets={} objects={} tilesets={} sheets={} \
         scan_errors={} elapsed_wall_ms={} first_import_ms={} second_import_ms={} \
         total_bytes_stored={} engine={} title={:?} encryption_key_detected={} \
         encrypted_assets={} largest_asset_bytes={} largest_asset_path={:?} \
         pathological_asset_over_100mb={}",
        second_counts.games,
        second_counts.assets,
        second_counts.objects,
        second_counts.tilesets,
        second_counts.sheets,
        second_counts.scan_errors,
        duration_millis(first_elapsed + second_elapsed),
        duration_millis(first_elapsed),
        duration_millis(second_elapsed),
        second_counts.total_bytes,
        expected_engine,
        expected_title,
        expected_encryption_key.is_some(),
        encrypted_assets,
        largest_asset_bytes,
        largest_asset_path,
        largest_asset_bytes > PATHOLOGICAL_ASSET_BYTES,
    );
    println!("REAL_GAME_SCAN_ERRORS_BY_CODE {scan_errors_by_code:?}");
    for example in &scan_error_examples {
        println!(
            "REAL_GAME_SCAN_ERROR_EXAMPLE code={:?} rel_path={:?} message={:?}",
            example.code,
            example.rel_path,
            single_line(&example.message)
        );
    }

    assert_eq!(
        source_after, source_before,
        "the importer changed source directory metadata or contents"
    );
    assert!(
        first.game_failures.is_empty(),
        "first import reported game failures: {:?}",
        first.game_failures
    );
    assert!(
        second.game_failures.is_empty(),
        "second import reported game failures: {:?}",
        second.game_failures
    );
    assert_eq!(first.games_imported, 1, "first import must find one game");
    assert_eq!(second.games_imported, 1, "second import must find one game");

    let game: (i64, String, String, String, Option<String>) = conn
        .query_row(
            "SELECT id, root_path, title, engine, encryption_key FROM games",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("read imported game");
    assert_eq!(game.1, expected_root);
    assert_eq!(game.2, expected_title);
    assert_eq!(game.3, expected_engine);
    assert_eq!(game.4, expected_encryption_key);
    assert_eq!(second_counts.games, 1, "reimport must keep one games row");
    assert!(
        second_counts.assets > NON_TRIVIAL_ASSET_COUNT,
        "expected more than {NON_TRIVIAL_ASSET_COUNT} real assets, got {}",
        second_counts.assets
    );
    assert!(second_counts.objects > 0, "no object rows were stored");

    let dangling_assets: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assets a \
             LEFT JOIN objects o ON o.sha256 = a.sha256 \
             WHERE o.sha256 IS NULL",
            [],
            |row| row.get(0),
        )
        .expect("check asset object references");
    assert_eq!(
        dangling_assets, 0,
        "every asset sha256 must resolve to an objects row"
    );
    assert_object_files(&conn, store.path());

    assert!(second_counts.tilesets > 0, "no tilesets were imported");
    assert!(second_counts.sheets > 0, "no tileset sheets were linked");
    let tileset_id: i64 = conn
        .query_row(
            "SELECT t.id FROM tilesets t \
             JOIN tileset_sheets s ON s.tileset_id = t.id \
             GROUP BY t.id ORDER BY t.id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("find a tileset with sheets");
    let tileset = crate::catalog_ipc::get_tileset(&conn, tileset_id)
        .expect("read tileset through catalog IPC")
        .expect("tileset must exist");
    assert_eq!(tileset.game_id, game.0);
    assert!(
        !tileset.sheets.is_empty(),
        "catalog IPC returned no real slots"
    );
    assert!(
        tileset
            .sheets
            .iter()
            .all(|sheet| TILESET_SLOTS.contains(&sheet.slot.as_str())),
        "catalog IPC returned an invalid tileset slot"
    );

    assert_eq!(
        second_counts, first_counts,
        "the second import changed catalog row counts"
    );
}

fn expected_engine_and_system_json(source_dir: &Path) -> (&'static str, PathBuf) {
    let mv_system = source_dir.join("www").join("data").join("System.json");
    if mv_system.is_file() {
        return ("mv", mv_system);
    }

    let mz_system = source_dir.join("data").join("System.json");
    assert!(
        mz_system.is_file(),
        "real game has neither www/data/System.json nor data/System.json"
    );
    ("mz", mz_system)
}

fn encryption_key_from_system_json(system_json_path: &Path) -> Option<String> {
    let raw = fs::read_to_string(system_json_path).expect("read real System.json");
    let value: serde_json::Value =
        serde_json::from_str(raw.trim_start_matches('\u{feff}')).expect("parse real System.json");
    value
        .get("encryptionKey")
        .and_then(serde_json::Value::as_str)
        .filter(|key| key.len() == 32 && key.chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
}

fn snapshot_source(root: &Path) -> BTreeMap<PathBuf, SourceEntry> {
    fn visit(root: &Path, path: &Path, entries: &mut BTreeMap<PathBuf, SourceEntry>) {
        let metadata = fs::symlink_metadata(path)
            .unwrap_or_else(|err| panic!("read metadata for {}: {err}", path.display()));
        let file_type = metadata.file_type();
        let kind = if file_type.is_dir() {
            SourceEntryKind::Directory
        } else if file_type.is_file() {
            SourceEntryKind::File
        } else if file_type.is_symlink() {
            SourceEntryKind::Symlink
        } else {
            SourceEntryKind::Other
        };
        let relative = path
            .strip_prefix(root)
            .expect("snapshot path must be under source root");
        let relative = if relative.as_os_str().is_empty() {
            PathBuf::from(".")
        } else {
            relative.to_path_buf()
        };
        entries.insert(
            relative,
            SourceEntry {
                bytes: metadata.len(),
                modified: metadata.modified().ok(),
                kind,
            },
        );

        if !file_type.is_dir() {
            return;
        }
        let mut children = fs::read_dir(path)
            .unwrap_or_else(|err| panic!("read directory {}: {err}", path.display()))
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_else(|err| panic!("read entry under {}: {err}", path.display()));
        children.sort_by_key(fs::DirEntry::file_name);
        for child in children {
            visit(root, &child.path(), entries);
        }
    }

    let mut entries = BTreeMap::new();
    visit(root, root, &mut entries);
    entries
}

fn catalog_counts(conn: &Connection) -> CatalogCounts {
    CatalogCounts {
        games: table_count(conn, "games"),
        assets: table_count(conn, "assets"),
        objects: table_count(conn, "objects"),
        tilesets: table_count(conn, "tilesets"),
        sheets: table_count(conn, "tileset_sheets"),
        scan_errors: table_count(conn, "scan_errors"),
        total_bytes: conn
            .query_row("SELECT COALESCE(SUM(bytes), 0) FROM objects", [], |row| {
                row.get(0)
            })
            .expect("sum object bytes"),
    }
}

fn table_count(conn: &Connection, table: &str) -> i64 {
    let allowed: HashSet<&str> = [
        "games",
        "assets",
        "objects",
        "tilesets",
        "tileset_sheets",
        "scan_errors",
    ]
    .into_iter()
    .collect();
    assert!(allowed.contains(table), "unexpected table name");
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap_or_else(|err| panic!("count {table}: {err}"))
}

fn assert_object_files(conn: &Connection, store_dir: &Path) {
    let mut stmt = conn
        .prepare("SELECT sha256, bytes FROM objects ORDER BY sha256")
        .expect("prepare object listing");
    let objects = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .expect("query objects");
    for object in objects {
        let (sha256, expected_bytes) = object.expect("read object row");
        assert!(sha256.len() >= 2, "invalid object sha256: {sha256:?}");
        let object_path = store_dir.join("objects").join(&sha256[..2]).join(&sha256);
        let metadata = fs::metadata(&object_path)
            .unwrap_or_else(|err| panic!("object file {}: {err}", object_path.display()));
        assert!(metadata.is_file(), "object path is not a file");
        assert_eq!(
            metadata.len(),
            expected_bytes,
            "object file size differs from catalog for {sha256}"
        );
    }
}

fn scan_error_counts(conn: &Connection) -> BTreeMap<String, i64> {
    let mut stmt = conn
        .prepare("SELECT code, COUNT(*) FROM scan_errors GROUP BY code ORDER BY code")
        .expect("prepare scan error counts");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query scan error counts")
        .collect::<Result<BTreeMap<_, _>, _>>()
        .expect("read scan error counts")
}

fn scan_error_examples(conn: &Connection, limit: i64) -> Vec<ScanErrorExample> {
    let mut stmt = conn
        .prepare(
            "SELECT code, rel_path, message FROM scan_errors \
             ORDER BY code, id LIMIT ?1",
        )
        .expect("prepare scan error examples");
    stmt.query_map([limit], |row| {
        Ok(ScanErrorExample {
            code: row.get(0)?,
            rel_path: row.get(1)?,
            message: row.get(2)?,
        })
    })
    .expect("query scan error examples")
    .collect::<Result<Vec<_>, _>>()
    .expect("read scan error examples")
}

fn largest_asset(conn: &Connection) -> (Option<String>, i64) {
    conn.query_row(
        "SELECT a.rel_path, o.bytes FROM assets a \
         JOIN objects o ON o.sha256 = a.sha256 \
         ORDER BY o.bytes DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .expect("query largest asset")
    .unwrap_or((None, 0))
}

fn duration_millis(duration: Duration) -> u128 {
    duration.as_millis()
}

fn single_line(message: &str) -> String {
    message.replace(['\r', '\n'], " ")
}
