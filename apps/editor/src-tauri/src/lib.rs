// The editor's frontend never touches SQL or the filesystem directly for
// catalog access — it crosses the IPC boundary through these three typed
// commands, backed by a read-only rusqlite connection opened once at
// startup (see catalog_ipc.rs's module doc for the design rationale).

mod catalog_ipc;

use std::sync::Mutex;

use catalog_ipc::{
    resolve_catalog_db_path, AssetFilter, AssetPage, CatalogError, GameRow, TilesetRow,
};
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

#[tauri::command]
fn catalog_list_games(state: tauri::State<CatalogState>) -> Result<Vec<GameRow>, CatalogError> {
    let guard = state.0.lock().expect("catalog mutex poisoned");
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::list_games(conn)
}

#[tauri::command]
fn catalog_list_assets(
    state: tauri::State<CatalogState>,
    filter: AssetFilter,
    page: u32,
) -> Result<AssetPage, CatalogError> {
    let guard = state.0.lock().expect("catalog mutex poisoned");
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::list_assets(conn, &filter, page)
}

#[tauri::command]
fn catalog_get_tileset(
    state: tauri::State<CatalogState>,
    id: i64,
) -> Result<Option<TilesetRow>, CatalogError> {
    let guard = state.0.lock().expect("catalog mutex poisoned");
    let conn = guard.as_ref().ok_or(CatalogError::NotFound)?;
    catalog_ipc::get_tileset(conn, id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(CatalogState(Mutex::new(open_state_connection())))
        .invoke_handler(tauri::generate_handler![
            catalog_list_games,
            catalog_list_assets,
            catalog_get_tileset
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ThreeMaker editor shell");
}
