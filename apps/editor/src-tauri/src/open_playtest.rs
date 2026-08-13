//! Spawn the ThreeMaker desktop playtest binary from the editor shell.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Typed IPC error for `open_playtest` (camelCase serde tag matches catalog commands).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "code", content = "message")]
pub enum PlaytestError {
    NotFound,
    SpawnFailed(String),
}

/// Ordered desktop binary candidates: env override, then local debug/release builds.
pub fn playtest_desktop_candidates(manifest_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(env_exe) = std::env::var("THREEMAKER_DESKTOP_EXE") {
        let trimmed = env_exe.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    let desktop_tauri = manifest_dir.join("../../desktop/src-tauri");
    let target_names = ["threemaker-desktop.exe", "threemaker-desktop"];

    for profile in ["debug", "release"] {
        for name in target_names {
            candidates.push(desktop_tauri.join("target").join(profile).join(name));
        }
    }

    candidates
}

fn first_existing_candidate(candidates: &[PathBuf]) -> Option<&PathBuf> {
    candidates.iter().find(|path| path.is_file())
}

/// Launches the first existing desktop binary from [`playtest_desktop_candidates`].
pub fn spawn_playtest_desktop(manifest_dir: &Path) -> Result<(), PlaytestError> {
    let candidates = playtest_desktop_candidates(manifest_dir);
    let exe = first_existing_candidate(&candidates).ok_or(PlaytestError::NotFound)?;

    Command::new(exe)
        .spawn()
        .map(|_| ())
        .map_err(|err| PlaytestError::SpawnFailed(err.to_string()))
}

#[tauri::command]
pub fn open_playtest() -> Result<(), PlaytestError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    spawn_playtest_desktop(&manifest_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playtest_desktop_candidates_is_non_empty() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let candidates = playtest_desktop_candidates(&manifest_dir);
        assert!(!candidates.is_empty());
    }

    #[test]
    fn spawn_playtest_desktop_returns_not_found_when_no_candidate_exists() {
        let missing_root = std::env::temp_dir().join(format!(
            "threemaker-playtest-missing-{}",
            std::process::id()
        ));
        let result = spawn_playtest_desktop(&missing_root);
        assert_eq!(result, Err(PlaytestError::NotFound));
    }
}
