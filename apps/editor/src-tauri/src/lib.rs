// The editor's frontend never touches SQL or the filesystem directly for
// catalog access — it crosses the IPC boundary through these typed
// commands, backed by a read-only rusqlite connection opened once at
// startup (see catalog_ipc.rs's module doc for the design rationale).

mod catalog_ipc;
mod import_catalog;
mod import_scan;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use catalog_ipc::{
    resolve_catalog_db_path, AssetFilter, AssetPage, CatalogError, GameRow, TilesetRow,
    TilesetSummaryRow,
};
use import_catalog::{import_path, ImportError, ImportSummary};
use rusqlite::Connection;

/// Holds the (optional) read-only catalog connection. `None` when the
/// catalog db doesn't exist yet (bulk scan never run) — every command
/// re-checks this and returns `CatalogError::NotFound` rather than crashing,
/// so the frontend can render a localized empty state.
struct CatalogState(Mutex<Option<Connection>>);

fn open_state_connection() -> Option<Connection> {
    let path = resolve_catalog_db_path();
    catalog_ipc::open_catalog_connection(&path).ok()
}

/// Replaces the in-memory read connection with a fresh open from disk.
/// Shared by `catalog_reload` and `catalog_import_path` so reload logic is
/// not duplicated.
fn reload_catalog_connection(state: &CatalogState) -> Result<(), CatalogError> {
    let mut guard = lock_catalog(state)?;
    *guard = open_state_connection();
    guard.as_ref().ok_or(CatalogError::NotFound)?;
    Ok(())
}

/// Locks the catalog mutex, mapping a poisoned lock (a previous panic while
/// holding it) to a clean `CatalogError::QueryFailed` IPC response instead
/// of panicking the whole Tauri command handler. A poisoned mutex still
/// holds a perfectly usable `Option<Connection>` underneath -- `.expect()`
/// here would turn one earlier panic into every subsequent catalog command
/// panicking too, which is strictly worse than surfacing one clean error.
fn lock_catalog(state: &CatalogState) -> Result<MutexGuard<'_, Option<Connection>>, CatalogError> {
    state.0.lock().map_err(|_| {
        CatalogError::QueryFailed(
            "catalog connection lock was poisoned by a previous internal error".to_string(),
        )
    })
}

#[tauri::command]
fn catalog_list_games(state: tauri::State<CatalogState>) -> Result<Vec<GameRow>, CatalogError> {
    let guard = lock_catalog(&state)?;
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::list_games(conn)
}

#[tauri::command]
fn catalog_list_assets(
    state: tauri::State<CatalogState>,
    filter: AssetFilter,
    page: u32,
) -> Result<AssetPage, CatalogError> {
    let guard = lock_catalog(&state)?;
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::list_assets(conn, &filter, page)
}

#[tauri::command]
fn catalog_get_tileset(
    state: tauri::State<CatalogState>,
    id: i64,
) -> Result<Option<TilesetRow>, CatalogError> {
    let guard = lock_catalog(&state)?;
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::get_tileset(conn, id)
}

#[tauri::command]
fn catalog_list_tilesets_for_game(
    state: tauri::State<CatalogState>,
    game_id: i64,
) -> Result<Vec<TilesetSummaryRow>, CatalogError> {
    let guard = lock_catalog(&state)?;
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::list_tilesets_for_game(conn, game_id)
}

/// Reopens the read-only catalog connection from disk. Needed because the
/// connection is opened once at startup and stays `None` when the db is
/// missing — after a first-ever import creates the db, every read command
/// would keep failing until an app restart without this reload.
#[tauri::command]
fn catalog_reload(state: tauri::State<CatalogState>) -> Result<(), CatalogError> {
    reload_catalog_connection(&state)
}

/// Returns the asset-store directory (the catalog db's parent folder) as a
/// string, so the frontend can compute `convertFileSrc` paths for object
/// preview images -- the asset-protocol scope in `tauri.conf.json` is
/// exactly this directory.
#[tauri::command]
fn catalog_asset_store_dir() -> String {
    resolve_catalog_db_path()
        .parent()
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Native in-editor import entry point: scan a host directory for RPG Maker
/// games, ingest assets and tilesets into the catalog, then reload the read
/// connection so the UI can query without a restart.
#[tauri::command]
fn catalog_import_path(
    state: tauri::State<CatalogState>,
    path: String,
    max_depth: Option<usize>,
) -> Result<ImportSummary, ImportError> {
    let store_dir = resolve_catalog_db_path()
        .parent()
        .map(PathBuf::from)
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| {
            ImportError::StoreFailed("could not resolve asset-store directory".into())
        })?;

    let summary = import_path(Path::new(&path), max_depth, &store_dir)?;
    reload_catalog_connection(&state).map_err(|err| match err {
        CatalogError::NotFound => ImportError::StoreFailed("catalog not found after import".into()),
        CatalogError::OpenFailed(message) | CatalogError::QueryFailed(message) => {
            ImportError::StoreFailed(message)
        }
        CatalogError::SchemaVersionMismatch(message) => ImportError::StoreFailed(message),
    })?;
    Ok(summary)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(CatalogState(Mutex::new(open_state_connection())))
        .invoke_handler(tauri::generate_handler![
            catalog_list_games,
            catalog_list_assets,
            catalog_get_tileset,
            catalog_list_tilesets_for_game,
            catalog_reload,
            catalog_asset_store_dir,
            catalog_import_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ThreeMaker editor shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poisoned_catalog_mutex_maps_to_a_clean_query_failed_error_instead_of_panicking() {
        let state = CatalogState(Mutex::new(None));

        // Deliberately poison the mutex from a panic while it's held --
        // exactly the scenario `lock_catalog` must survive without
        // panicking itself.
        let poison_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.0.lock().expect("lock for poisoning");
            panic!("intentional poison for test");
        }));
        assert!(
            poison_result.is_err(),
            "the panic should have poisoned the mutex"
        );

        let outcome = lock_catalog(&state);
        match outcome {
            Err(CatalogError::QueryFailed(message)) => {
                assert!(message.contains("poisoned"));
            }
            other => panic!("expected a clean QueryFailed error, got {other:?}"),
        }
    }
}
