//! RPG Maker MV/MZ game discovery, encrypted-asset decode, and content-addressed
//! object storage — a native Rust port of `packages/assets/src/{scanner,decrypt,
//! object-store}.ts` for the packaged editor importer (slice A1).
//!
//! Source game folders are read-only; writes happen only under an explicit
//! `store_dir` passed to `store_asset`.
//!
//! `games.title` parity with `packages/assets/src/catalog.ts`: both importers
//! prefer a non-empty trimmed `System.json` `gameTitle`, falling back to the
//! folder basename (`ScannedGame::folder_title`).
#![allow(dead_code)] // Slice A1: wired by A2 Tauri commands and catalog writer.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const DEFAULT_MAX_DEPTH: usize = 12;

const FAKE_HEADER_LEN: usize = 16;
const XOR_LEN: usize = 16;
const KEY_LEN: usize = 16;
const FAN_OUT_LEN: usize = 2;

const FAKE_HEADER_MAGIC: [u8; 5] = [0x52, 0x50, 0x47, 0x4d, 0x56];
const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OGG_MAGIC: [u8; 4] = [0x4f, 0x67, 0x67, 0x53];
const M4A_FTYP_MAGIC: [u8; 4] = [0x66, 0x74, 0x79, 0x70];
const M4A_FTYP_OFFSET: usize = 4;
const RIFF_MAGIC: [u8; 4] = [0x52, 0x49, 0x46, 0x46];
const WEBP_FOURCC_MAGIC: [u8; 4] = [0x57, 0x45, 0x42, 0x50];
const WAVE_FOURCC_MAGIC: [u8; 4] = [0x57, 0x41, 0x56, 0x45];
const RIFF_FOURCC_OFFSET: usize = 8;
const JPEG_SOI_MAGIC: [u8; 3] = [0xff, 0xd8, 0xff];
const GIF8_MAGIC: [u8; 4] = [0x47, 0x49, 0x46, 0x38];
const ID3_MAGIC: [u8; 3] = [0x49, 0x44, 0x33];

const IMAGE_EXTENSIONS: &[&str] = &[".png", ".rpgmvp", ".png_"];
const AUDIO_EXTENSIONS: &[&str] = &[".ogg", ".m4a", ".rpgmvo", ".ogg_", ".m4a_"];
const ENCRYPTED_EXTENSIONS: &[&str] = &[".rpgmvp", ".png_", ".rpgmvo", ".ogg_", ".m4a_"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RpgmEngine {
    Mv,
    Mz,
}

impl RpgmEngine {
    #[cfg(test)]
    fn as_str(&self) -> &'static str {
        match self {
            RpgmEngine::Mv => "mv",
            RpgmEngine::Mz => "mz",
        }
    }
}

/// One discovered RPG Maker MV/MZ game root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedGame {
    pub root_path: PathBuf,
    pub engine: RpgmEngine,
    /// Folder basename of `root_path` — used when `system_title` is absent or blank.
    pub folder_title: String,
    /// `System.json` `gameTitle` when present; persisted into `games.title` when non-empty.
    pub system_title: Option<String>,
    pub has_encrypted_images: bool,
    pub has_encrypted_audio: bool,
    /// Hex-encoded 16-byte key from `System.json`, when parseable.
    pub encryption_key: Option<String>,
    pub image_assets: Vec<String>,
    pub audio_assets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScanErrorCode {
    InvalidSystemJson,
    ReadError,
    DepthExceeded,
    CycleDetected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanError {
    pub path: PathBuf,
    pub code: ScanErrorCode,
    pub message: String,
}

impl Serialize for ScanError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ScanError", 3)?;
        state.serialize_field("path", &self.path.display().to_string())?;
        state.serialize_field("code", &self.code)?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanResult {
    pub games: Vec<ScannedGame>,
    pub errors: Vec<ScanError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportScanError {
    RootNotFound(String),
    RootNotDirectory(String),
    StoreFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecryptErrorCode {
    BadHeader,
    Truncated,
    BadKey,
    MagicMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptError {
    pub code: DecryptErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAsset {
    pub bytes: Vec<u8>,
    pub was_encrypted: bool,
}

struct DetectedDataDir {
    data_dir: PathBuf,
    engine: RpgmEngine,
}

enum ScanBuildError {
    InvalidSystemJson(String),
    ReadError(String),
}

/// Default asset-store directory (`~/.threemaker/asset-store`), matching
/// `packages/assets`' CLI default and the parent of `catalog_ipc`'s
/// `resolve_catalog_db_path()`.
pub fn default_asset_store_dir() -> PathBuf {
    if let Ok(override_path) = std::env::var("THREEMAKER_ASSET_STORE_DIR") {
        return PathBuf::from(override_path);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".threemaker").join("asset-store")
}

/// Recursively discovers RPG Maker MV/MZ games under `root`. Per-folder failures
/// are collected in `errors` so one broken game never aborts the run.
pub fn scan_games(root: &Path, max_depth: usize) -> Result<ScanResult, ImportScanError> {
    if !root.exists() {
        return Err(ImportScanError::RootNotFound(format!(
            "Scan root does not exist: {}",
            root.display()
        )));
    }
    if !root.is_dir() {
        return Err(ImportScanError::RootNotDirectory(format!(
            "Scan root is not a directory: {}",
            root.display()
        )));
    }

    let mut games = Vec::new();
    let mut errors = Vec::new();
    walk_for_games(root, max_depth, &mut games, &mut errors);
    Ok(ScanResult { games, errors })
}

/// Convenience wrapper using the scanner's default max depth of 12.
pub fn scan_games_default_depth(root: &Path) -> Result<ScanResult, ImportScanError> {
    scan_games(root, DEFAULT_MAX_DEPTH)
}

/// Parses `System.json.encryptionKey` (32 hex chars) into raw key bytes.
/// Returns `None` when absent, empty, or not valid hex.
pub fn parse_encryption_key(system_json: &Value) -> Option<Vec<u8>> {
    let key = system_json.get("encryptionKey")?.as_str()?;
    if key.len() != 32 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    hex::decode(key).ok().filter(|bytes| bytes.len() == KEY_LEN)
}

/// Decrypts an RPG Maker MV/MZ encrypted asset (`.rpgmvp`, `.png_`, etc.).
pub fn decrypt_rpgmv(data: &[u8], key: &[u8]) -> Result<Vec<u8>, DecryptError> {
    if data.len() < FAKE_HEADER_LEN + XOR_LEN {
        return Err(DecryptError {
            code: DecryptErrorCode::Truncated,
            message: format!("Encrypted asset is too short ({} bytes).", data.len()),
        });
    }
    if !bytes_match_at(data, 0, &FAKE_HEADER_MAGIC) {
        return Err(DecryptError {
            code: DecryptErrorCode::BadHeader,
            message: "Fake RPGMV header magic is missing or corrupt.".to_string(),
        });
    }
    if key.len() != KEY_LEN {
        return Err(DecryptError {
            code: DecryptErrorCode::BadKey,
            message: format!("Encryption key must be {KEY_LEN} bytes, got {}.", key.len()),
        });
    }

    let mut decrypted_chunk = [0u8; XOR_LEN];
    for i in 0..XOR_LEN {
        decrypted_chunk[i] = data[FAKE_HEADER_LEN + i] ^ key[i];
    }

    let mut output = Vec::with_capacity(XOR_LEN + data.len() - FAKE_HEADER_LEN - XOR_LEN);
    output.extend_from_slice(&decrypted_chunk);
    output.extend_from_slice(&data[FAKE_HEADER_LEN + XOR_LEN..]);

    if !has_known_magic(&output) {
        return Err(DecryptError {
            code: DecryptErrorCode::MagicMismatch,
            message:
                "Decrypted output does not match any known asset magic bytes — the key is likely wrong."
                    .to_string(),
        });
    }

    Ok(output)
}

/// Decodes asset bytes. Encrypted extensions are decrypted with `key`; plain
/// assets pass through with `was_encrypted = false`.
pub fn decode_asset_bytes(
    rel_path: &str,
    data: &[u8],
    key: Option<&[u8]>,
) -> Result<DecodedAsset, DecryptError> {
    if is_encrypted_extension(rel_path) {
        let key = key.ok_or_else(|| DecryptError {
            code: DecryptErrorCode::BadKey,
            message: format!(
                "Asset \"{rel_path}\" has an encrypted extension but no usable encryption key."
            ),
        })?;
        let bytes = decrypt_rpgmv(data, key)?;
        Ok(DecodedAsset {
            bytes,
            was_encrypted: true,
        })
    } else {
        Ok(DecodedAsset {
            bytes: data.to_vec(),
            was_encrypted: false,
        })
    }
}

/// Content-addressed idempotent write under `store_dir/objects/{sha[0:2]}/{sha256}`.
pub fn store_asset(store_dir: &Path, bytes: &[u8]) -> Result<String, ImportScanError> {
    let sha256 = hash_bytes(bytes);
    let path = object_path(store_dir, &sha256);

    if path.exists() {
        return Ok(sha256);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| ImportScanError::StoreFailed(err.to_string()))?;
    }

    let tmp_path = path.with_extension(format!("tmp-{}-{}", std::process::id(), rand_suffix()));
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|err| ImportScanError::StoreFailed(err.to_string()))?;
        file.write_all(bytes)
            .map_err(|err| ImportScanError::StoreFailed(err.to_string()))?;
    }
    fs::rename(&tmp_path, &path).map_err(|err| ImportScanError::StoreFailed(err.to_string()))?;

    Ok(sha256)
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

fn object_path(store_dir: &Path, sha256: &str) -> PathBuf {
    store_dir
        .join("objects")
        .join(&sha256[..FAN_OUT_LEN])
        .join(sha256)
}

fn rand_suffix() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

fn walk_for_games(
    root_dir: &Path,
    max_depth: usize,
    games: &mut Vec<ScannedGame>,
    errors: &mut Vec<ScanError>,
) {
    let mut game_errors = Vec::new();
    let mut on_directory = |dir: &Path, _depth: usize| {
        if let Some(detected) = detect_data_dir(dir) {
            match build_game_record(dir, &detected, max_depth, &mut game_errors) {
                Ok(game) => games.push(game),
                Err(ScanBuildError::InvalidSystemJson(message)) => {
                    game_errors.push(ScanError {
                        path: dir.to_path_buf(),
                        code: ScanErrorCode::InvalidSystemJson,
                        message,
                    });
                }
                Err(ScanBuildError::ReadError(message)) => {
                    game_errors.push(ScanError {
                        path: dir.to_path_buf(),
                        code: ScanErrorCode::ReadError,
                        message,
                    });
                }
            }
            false
        } else {
            true
        }
    };
    let mut handlers = GuardedWalkHandlers {
        on_directory: &mut on_directory,
        on_file: None,
    };
    guarded_walk(root_dir, max_depth, errors, &mut handlers);
    errors.append(&mut game_errors);
}

struct GuardedWalkHandlers<'a> {
    on_directory: &'a mut dyn FnMut(&Path, usize) -> bool,
    #[allow(clippy::type_complexity)]
    on_file: Option<&'a mut dyn FnMut(&Path, &str)>,
}

fn guarded_walk(
    root_dir: &Path,
    max_depth: usize,
    errors: &mut Vec<ScanError>,
    handlers: &mut GuardedWalkHandlers<'_>,
) {
    let mut visited_real_paths = HashSet::new();

    fn walk(
        dir: &Path,
        depth: usize,
        rel_prefix: &str,
        max_depth: usize,
        visited_real_paths: &mut HashSet<PathBuf>,
        errors: &mut Vec<ScanError>,
        handlers: &mut GuardedWalkHandlers<'_>,
    ) {
        if depth > max_depth {
            errors.push(ScanError {
                path: dir.to_path_buf(),
                code: ScanErrorCode::DepthExceeded,
                message: format!(
                    "Max scan depth ({max_depth}) exceeded at \"{}\" — abandoning this branch.",
                    dir.display()
                ),
            });
            return;
        }

        let real_path = match fs::canonicalize(dir) {
            Ok(path) => path,
            Err(err) => {
                errors.push(ScanError {
                    path: dir.to_path_buf(),
                    code: ScanErrorCode::ReadError,
                    message: describe_error(&err),
                });
                return;
            }
        };

        if !visited_real_paths.insert(real_path.clone()) {
            errors.push(ScanError {
                path: dir.to_path_buf(),
                code: ScanErrorCode::CycleDetected,
                message: format!(
                    "Cycle detected at \"{}\" (real path \"{}\" already visited) — abandoning this branch.",
                    dir.display(),
                    real_path.display()
                ),
            });
            return;
        }

        if !(handlers.on_directory)(dir, depth) {
            return;
        }

        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(err) => {
                errors.push(ScanError {
                    path: dir.to_path_buf(),
                    code: ScanErrorCode::ReadError,
                    message: describe_error(&err),
                });
                return;
            }
        };

        for entry in entries.flatten() {
            let entry_path = entry.path();
            let rel_path = if rel_prefix.is_empty() {
                entry.file_name().to_string_lossy().into_owned()
            } else {
                format!("{}/{}", rel_prefix, entry.file_name().to_string_lossy())
            };

            if is_traversable_directory(&entry, &entry_path) {
                walk(
                    &entry_path,
                    depth + 1,
                    &rel_path,
                    max_depth,
                    visited_real_paths,
                    errors,
                    handlers,
                );
            } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Some(on_file) = handlers.on_file.as_mut() {
                    on_file(&entry_path, &rel_path);
                }
            }
        }
    }

    walk(
        root_dir,
        0,
        "",
        max_depth,
        &mut visited_real_paths,
        errors,
        handlers,
    );
}

fn is_traversable_directory(entry: &fs::DirEntry, entry_path: &Path) -> bool {
    let file_type = match entry.file_type() {
        Ok(file_type) => file_type,
        Err(_) => return false,
    };
    if file_type.is_dir() {
        return true;
    }
    if !file_type.is_symlink() {
        return false;
    }
    fs::metadata(entry_path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

fn detect_data_dir(dir: &Path) -> Option<DetectedDataDir> {
    let mv_data_dir = dir.join("www").join("data");
    if mv_data_dir.join("System.json").is_file() {
        return Some(DetectedDataDir {
            data_dir: mv_data_dir,
            engine: RpgmEngine::Mv,
        });
    }

    let mz_data_dir = dir.join("data");
    if mz_data_dir.join("System.json").is_file() {
        return Some(DetectedDataDir {
            data_dir: mz_data_dir,
            engine: RpgmEngine::Mz,
        });
    }

    None
}

fn build_game_record(
    root_path: &Path,
    detected: &DetectedDataDir,
    max_depth: usize,
    errors: &mut Vec<ScanError>,
) -> Result<ScannedGame, ScanBuildError> {
    let system_json_path = detected.data_dir.join("System.json");
    let raw = fs::read_to_string(&system_json_path).map_err(|err| {
        ScanBuildError::ReadError(format!(
            "Could not read \"{}\": {}",
            system_json_path.display(),
            describe_error(&err)
        ))
    })?;

    let system_json: Value = serde_json::from_str(&strip_bom(&raw)).map_err(|err| {
        ScanBuildError::InvalidSystemJson(format!(
            "Corrupt System.json at \"{}\": {}",
            system_json_path.display(),
            describe_error(&err)
        ))
    })?;

    let has_encrypted_images = read_boolean_flag(&system_json, "hasEncryptedImages");
    let has_encrypted_audio = read_boolean_flag(&system_json, "hasEncryptedAudio");
    let encryption_key = parse_encryption_key(&system_json).map(hex::encode);
    let system_title = system_json
        .get("gameTitle")
        .and_then(Value::as_str)
        .map(str::to_string);
    let asset_root = detected.data_dir.parent().unwrap_or(root_path);

    let absolute_root = fs::canonicalize(root_path).unwrap_or_else(|_| root_path.to_path_buf());
    let normalized_root = normalize_root_path(&absolute_root);
    let folder_title = folder_title_from_root(&normalized_root);

    Ok(ScannedGame {
        root_path: normalized_root,
        engine: detected.engine.clone(),
        folder_title,
        system_title,
        has_encrypted_images,
        has_encrypted_audio,
        encryption_key,
        image_assets: collect_asset_files(
            &asset_root.join("img"),
            IMAGE_EXTENSIONS,
            max_depth,
            errors,
        ),
        audio_assets: collect_asset_files(
            &asset_root.join("audio"),
            AUDIO_EXTENSIONS,
            max_depth,
            errors,
        ),
    })
}

fn read_boolean_flag(system_json: &Value, key: &str) -> bool {
    system_json
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn collect_asset_files(
    dir: &Path,
    extensions: &[&str],
    max_depth: usize,
    errors: &mut Vec<ScanError>,
) -> Vec<String> {
    if !dir.is_dir() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut asset_errors = Vec::new();
    let mut on_directory = |_dir: &Path, _depth: usize| true;
    let mut on_file = |entry_path: &Path, rel_path: &str| {
        if extension_matches(entry_path, extensions) {
            results.push(rel_path.to_string());
        }
    };
    let mut handlers = GuardedWalkHandlers {
        on_directory: &mut on_directory,
        on_file: Some(&mut on_file),
    };
    guarded_walk(dir, max_depth, &mut asset_errors, &mut handlers);
    errors.append(&mut asset_errors);
    results.sort();
    results
}

fn extension_matches(path: &Path, extensions: &[&str]) -> bool {
    let ext = path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase);
    ext.as_deref()
        .map(|ext| {
            extensions
                .iter()
                .any(|candidate| candidate.trim_start_matches('.') == ext)
        })
        .unwrap_or(false)
}

fn is_encrypted_extension(rel_path: &str) -> bool {
    Path::new(rel_path)
        .extension()
        .and_then(OsStr::to_str)
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            ENCRYPTED_EXTENSIONS
                .iter()
                .any(|candidate| candidate.trim_start_matches('.') == lower)
        })
        .unwrap_or(false)
}

fn strip_bom(text: &str) -> String {
    if text.starts_with('\u{feff}') {
        text[1..].to_string()
    } else {
        text.to_string()
    }
}

fn bytes_match_at(data: &[u8], offset: usize, expected: &[u8]) -> bool {
    data.len() >= offset + expected.len() && data[offset..offset + expected.len()] == expected[..]
}

fn is_mp3_frame_sync(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0xff && data[1] >= 0xe0
}

fn is_riff_container(data: &[u8], fourcc: &[u8]) -> bool {
    bytes_match_at(data, 0, &RIFF_MAGIC) && bytes_match_at(data, RIFF_FOURCC_OFFSET, fourcc)
}

fn has_known_magic(data: &[u8]) -> bool {
    bytes_match_at(data, 0, &PNG_MAGIC)
        || bytes_match_at(data, 0, &JPEG_SOI_MAGIC)
        || bytes_match_at(data, 0, &GIF8_MAGIC)
        || bytes_match_at(data, 0, &OGG_MAGIC)
        || bytes_match_at(data, M4A_FTYP_OFFSET, &M4A_FTYP_MAGIC)
        || is_riff_container(data, &WEBP_FOURCC_MAGIC)
        || is_riff_container(data, &WAVE_FOURCC_MAGIC)
        || bytes_match_at(data, 0, &ID3_MAGIC)
        || is_mp3_frame_sync(data)
}

fn describe_error(err: &dyn std::error::Error) -> String {
    err.to_string()
}

/// Strips Windows extended-length verbatim prefixes (`\\?\`, `\\?\UNC\`) so
/// `games.root_path` keys match the TypeScript scanner's walk-time paths.
pub fn normalize_root_path(path: &Path) -> PathBuf {
    let raw = path.display().to_string();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        PathBuf::from(raw)
    }
}

/// Mirrors `basenameOf` in `packages/assets/src/catalog.ts` (trailing separators
/// and root-path edge cases included).
fn folder_title_from_root(root_path: &Path) -> String {
    let normalized = root_path.display().to_string().replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    segments
        .last()
        .map(|segment| (*segment).to_string())
        .unwrap_or(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    const KEY_HEX: &str = "d41d8cd98f00b204e9800998ecf8427e";

    const FAKE_HEADER: [u8; 16] = [
        0x52, 0x50, 0x47, 0x4d, 0x56, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];

    const VALID_SYSTEM_JSON: &str = r#"{"gameTitle":"Test Game","hasEncryptedImages":false}"#;
    const ENCRYPTED_SYSTEM_JSON: &str = r#"{
        "gameTitle":"Encrypted Game",
        "hasEncryptedImages":true,
        "encryptionKey":"d41d8cd98f00b204e9800998ecf8427e"
    }"#;

    fn key_bytes() -> Vec<u8> {
        hex::decode(KEY_HEX).expect("valid key hex")
    }

    fn write_system_json(data_dir: &Path, contents: &str) {
        fs::create_dir_all(data_dir).expect("create data dir");
        fs::write(data_dir.join("System.json"), contents).expect("write System.json");
    }

    fn xor16(plain: &[u8], key: &[u8]) -> Vec<u8> {
        plain
            .iter()
            .zip(key.iter())
            .take(16)
            .map(|(p, k)| p ^ k)
            .collect()
    }

    fn encrypt_fixture(plain: &[u8], key: &[u8]) -> Vec<u8> {
        let first16 = &plain[..16.min(plain.len())];
        let mut xored = xor16(first16, key);
        while xored.len() < 16 {
            xored.push(0);
        }
        let mut out = FAKE_HEADER.to_vec();
        out.extend_from_slice(&xored);
        if plain.len() > 16 {
            out.extend_from_slice(&plain[16..]);
        }
        out
    }

    #[test]
    fn discovers_mv_and_mz_games_with_correct_engine_title_and_assets() {
        let work = TempDir::new().expect("tempdir");
        let work_dir = work.path();

        let mz_root = work_dir.join("mz-game");
        write_system_json(&mz_root.join("data"), ENCRYPTED_SYSTEM_JSON);
        fs::create_dir_all(mz_root.join("img/tilesets")).expect("mz img dir");
        fs::write(
            mz_root.join("img/tilesets/Outside.rpgmvp"),
            b"fake-encrypted-bytes",
        )
        .expect("mz image");
        fs::create_dir_all(mz_root.join("audio/bgm")).expect("mz audio dir");
        fs::write(
            mz_root.join("audio/bgm/Theme.ogg_"),
            b"fake-encrypted-audio",
        )
        .expect("mz audio");

        let mv_root = work_dir.join("mv-game");
        write_system_json(&mv_root.join("www/data"), VALID_SYSTEM_JSON);
        fs::create_dir_all(mv_root.join("www/img/characters")).expect("mv img dir");
        fs::write(
            mv_root.join("www/img/characters/Actor1.png"),
            b"fake-plain-png",
        )
        .expect("mv image");

        let result = scan_games(work_dir, 12).expect("scan succeeds");
        assert!(result.errors.is_empty());
        assert_eq!(result.games.len(), 2);

        let mz = result
            .games
            .iter()
            .find(|game| game.root_path.ends_with("mz-game"))
            .expect("mz game");
        assert_eq!(mz.engine, RpgmEngine::Mz);
        assert_eq!(mz.folder_title, "mz-game");
        assert_eq!(mz.system_title.as_deref(), Some("Encrypted Game"));
        assert!(mz.has_encrypted_images);
        assert!(!mz.has_encrypted_audio);
        assert_eq!(mz.encryption_key.as_deref(), Some(KEY_HEX));
        assert_eq!(mz.image_assets, vec!["tilesets/Outside.rpgmvp"]);
        assert_eq!(mz.audio_assets, vec!["bgm/Theme.ogg_"]);

        let mv = result
            .games
            .iter()
            .find(|game| game.root_path.ends_with("mv-game"))
            .expect("mv game");
        assert_eq!(mv.engine, RpgmEngine::Mv);
        assert_eq!(mv.folder_title, "mv-game");
        assert_eq!(mv.system_title.as_deref(), Some("Test Game"));
        assert!(!mv.has_encrypted_images);
        assert!(!mv.has_encrypted_audio);
        assert!(mv.encryption_key.is_none());
        assert_eq!(mv.image_assets, vec!["characters/Actor1.png"]);
        assert!(mv.audio_assets.is_empty());
    }

    #[test]
    fn folder_title_and_system_title_differ_when_folder_name_is_not_game_title() {
        let work = TempDir::new().expect("tempdir");
        let game_root = work.path().join("My Cool Folder Name");
        write_system_json(
            &game_root.join("data"),
            r#"{"gameTitle":"Different Display Title","hasEncryptedImages":false}"#,
        );

        let result = scan_games(work.path(), 12).expect("scan succeeds");
        assert_eq!(result.games.len(), 1);
        let game = &result.games[0];
        assert_eq!(game.folder_title, "My Cool Folder Name");
        assert_eq!(
            game.system_title.as_deref(),
            Some("Different Display Title")
        );
    }

    #[test]
    fn folder_title_from_root_matches_catalog_basename_of_semantics() {
        assert_eq!(
            folder_title_from_root(Path::new(r"C:\games\mv-game\")),
            "mv-game"
        );
        assert_eq!(folder_title_from_root(Path::new("/")), "/");
        assert_eq!(folder_title_from_root(Path::new("C:/")), "C:");
    }

    #[test]
    fn skips_non_rpgm_folders() {
        let work = TempDir::new().expect("tempdir");
        fs::create_dir_all(work.path().join("just-a-folder")).expect("mkdir");
        fs::write(work.path().join("just-a-folder/readme.txt"), b"hello").expect("write");

        let result = scan_games(work.path(), 12).expect("scan succeeds");
        assert!(result.games.is_empty());
        assert!(result.errors.is_empty());
    }

    #[test]
    fn malformed_subfolder_yields_soft_error_and_valid_sibling_is_returned() {
        let work = TempDir::new().expect("tempdir");
        let work_dir = work.path();

        let good_a = work_dir.join("good-a");
        write_system_json(&good_a.join("data"), VALID_SYSTEM_JSON);

        let broken = work_dir.join("broken");
        write_system_json(&broken.join("data"), "{ this is not valid json ");

        let good_c = work_dir.join("good-c");
        write_system_json(&good_c.join("data"), VALID_SYSTEM_JSON);

        let result = scan_games(work_dir, 12).expect("scan succeeds");
        assert_eq!(result.games.len(), 2);
        assert!(result
            .games
            .iter()
            .any(|game| game.root_path.ends_with("good-a")));
        assert!(result
            .games
            .iter()
            .any(|game| game.root_path.ends_with("good-c")));

        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].code, ScanErrorCode::InvalidSystemJson);
        assert!(result.errors[0].path.ends_with("broken"));
    }

    #[test]
    fn max_depth_prevents_discovering_deeply_nested_projects() {
        let work = TempDir::new().expect("tempdir");
        let mut current = work.path().join("a");
        fs::create_dir_all(&current).expect("mkdir root");

        for _ in 0..8 {
            current = current.join("nested");
            fs::create_dir_all(&current).expect("mkdir nested");
        }

        write_system_json(&current.join("data"), VALID_SYSTEM_JSON);

        let result = scan_games(work.path(), 5).expect("scan succeeds");
        assert!(result.games.is_empty());
        assert!(result
            .errors
            .iter()
            .any(|err| err.code == ScanErrorCode::DepthExceeded));
    }

    #[test]
    fn encryption_key_extraction_and_absence() {
        let with_key = serde_json::from_str::<Value>(ENCRYPTED_SYSTEM_JSON).expect("json");
        assert_eq!(
            parse_encryption_key(&with_key).map(hex::encode),
            Some(KEY_HEX.to_string())
        );

        let without_key = serde_json::from_str::<Value>(VALID_SYSTEM_JSON).expect("json");
        assert!(parse_encryption_key(&without_key).is_none());
    }

    #[test]
    fn decrypts_jpeg_and_gif_renamed_png_fixtures() {
        let key = key_bytes();

        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe0];
        jpeg.extend_from_slice(b"synthetic-jpeg-body");
        let encrypted_jpeg = encrypt_fixture(&jpeg, &key);
        let decrypted_jpeg =
            decode_asset_bytes("tilesets/Outside.png_", &encrypted_jpeg, Some(&key))
                .expect("decrypt jpeg fixture");
        assert!(decrypted_jpeg.was_encrypted);
        assert_eq!(decrypted_jpeg.bytes, jpeg);

        let mut gif = b"GIF8".to_vec();
        gif.extend_from_slice(b"9a-synthetic-body");
        let encrypted_gif = encrypt_fixture(&gif, &key);
        let decrypted_gif =
            decode_asset_bytes("tilesets/Outside.png_", &encrypted_gif, Some(&key))
                .expect("decrypt gif fixture");
        assert!(decrypted_gif.was_encrypted);
        assert_eq!(decrypted_gif.bytes, gif);
    }

    #[test]
    fn decrypts_encrypted_fixture_and_passes_through_plain_asset() {
        let key = key_bytes();
        let mut plain = PNG_MAGIC.to_vec();
        plain.extend_from_slice(&[0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
        plain.extend_from_slice(b"synthetic-png-body");

        let encrypted = encrypt_fixture(&plain, &key);
        let decrypted = decode_asset_bytes("tilesets/Outside.rpgmvp", &encrypted, Some(&key))
            .expect("decrypt encrypted asset");
        assert!(decrypted.was_encrypted);
        assert_eq!(decrypted.bytes, plain);

        let plain_pass =
            decode_asset_bytes("characters/Actor1.png", &plain, Some(&key)).expect("plain asset");
        assert!(!plain_pass.was_encrypted);
        assert_eq!(plain_pass.bytes, plain);
    }

    #[test]
    fn store_asset_is_idempotent() {
        let store = TempDir::new().expect("tempdir");
        let bytes = b"same-content";

        let first = store_asset(store.path(), bytes).expect("first store");
        let second = store_asset(store.path(), bytes).expect("second store");
        assert_eq!(first, second);

        let object_path = object_path(store.path(), &first);
        assert!(object_path.is_file());

        let entries: Vec<_> = fs::read_dir(object_path.parent().expect("parent"))
            .expect("read dir")
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(&first))
            .collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn scan_root_validation_errors_are_typed() {
        let missing = Path::new("this/path/does/not/exist/for-import-scan");
        assert!(matches!(
            scan_games(missing, 12),
            Err(ImportScanError::RootNotFound(_))
        ));

        let work = TempDir::new().expect("tempdir");
        let file_path = work.path().join("not-a-dir.txt");
        let mut file = fs::File::create(&file_path).expect("create file");
        file.write_all(b"x").expect("write file");

        assert!(matches!(
            scan_games(&file_path, 12),
            Err(ImportScanError::RootNotDirectory(_))
        ));
    }

    #[test]
    fn normalize_root_path_strips_windows_verbatim_prefixes() {
        assert_eq!(
            normalize_root_path(Path::new(r"\\?\C:\games\mv-game")),
            PathBuf::from(r"C:\games\mv-game")
        );
        assert_eq!(
            normalize_root_path(Path::new(r"\\?\UNC\server\share\game")),
            PathBuf::from(r"\\server\share\game")
        );
        assert_eq!(
            normalize_root_path(Path::new("/games/mz-game")),
            PathBuf::from("/games/mz-game")
        );
    }

    #[test]
    fn default_asset_store_dir_matches_catalog_convention() {
        let store = default_asset_store_dir();
        assert!(
            store.ends_with(".threemaker/asset-store")
                || store.ends_with(".threemaker\\asset-store")
        );
    }
}
