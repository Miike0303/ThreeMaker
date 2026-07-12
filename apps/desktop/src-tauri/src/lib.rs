// Phase 0: no custom commands yet. The frontend owns the three.js scene;
// this shell only hosts the WebView and will grow Rust-side commands
// (file I/O, project save/load, ...) in later phases.
//
// The `fs` plugin is wired here (Slice 3: "Tauri fs wiring") so the
// frontend's `@tauri-apps/plugin-fs` JS API can read the shared authored
// map file (`$HOME/.threemaker/maps/current.tmmap.json`) and asset-store
// texture objects -- see `capabilities/default.json` for the exact scopes.
// The authored-load call site itself (reading + translating the map on
// startup) is Slice 4's work, not wired into `run()` yet.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the ThreeMaker desktop shell");
}
