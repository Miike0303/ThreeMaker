// Phase 0: no custom commands yet. The frontend owns the three.js scene;
// this shell only hosts the WebView and will grow Rust-side commands
// (file I/O, project save/load, ...) in later phases.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the ThreeMaker desktop shell");
}
