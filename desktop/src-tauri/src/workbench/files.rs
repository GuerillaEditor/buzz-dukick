use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use super::path_guard::{display_path, drive_roots, PathGuard};

const TEXT_PREVIEW_LIMIT: u64 = 1024 * 1024;
const FILE_READ_LIMIT: u64 = 64 * 1024 * 1024;

#[cfg(test)]
const FILE_COMMAND_NAMES: [&str; 5] = [
    "workbench_files_roots",
    "workbench_files_list",
    "workbench_files_preview",
    "workbench_files_read",
    "workbench_files_reveal",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRoot {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    mime: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Text,
    Image,
    Video,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewType {
    kind: PreviewKind,
    mime: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    name: String,
    path: String,
    mime: String,
    kind: PreviewKind,
    text: Option<String>,
    base64: Option<String>,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    name: String,
    mime: String,
    base64: String,
    size: u64,
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| "path has no valid UTF-8 file name".to_string())
}

fn extension(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn classify_preview(path: impl AsRef<Path>) -> Result<PreviewType, String> {
    let (kind, mime) = match extension(path).as_str() {
        "txt" | "log" => (PreviewKind::Text, "text/plain"),
        "md" | "markdown" => (PreviewKind::Text, "text/markdown"),
        "json" => (PreviewKind::Text, "application/json"),
        "yaml" | "yml" => (PreviewKind::Text, "application/yaml"),
        "toml" => (PreviewKind::Text, "application/toml"),
        "csv" => (PreviewKind::Text, "text/csv"),
        "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "css" | "scss" | "py" | "ps1"
        | "psm1" | "sh" | "bat" | "cmd" | "ini" | "cfg" | "conf" | "env" | "go" | "java" | "c"
        | "h" | "cpp" | "hpp" | "cs" | "vue" | "svelte" | "sql" | "srt" | "vtt" | "lock"
        | "gitignore" | "nk" | "jsonl" => (PreviewKind::Text, "text/plain"),
        "html" | "htm" => (PreviewKind::Text, "text/html"),
        "xml" => (PreviewKind::Text, "application/xml"),
        "png" => (PreviewKind::Image, "image/png"),
        "jpg" | "jpeg" => (PreviewKind::Image, "image/jpeg"),
        "gif" => (PreviewKind::Image, "image/gif"),
        "webp" => (PreviewKind::Image, "image/webp"),
        "bmp" => (PreviewKind::Image, "image/bmp"),
        "svg" => (PreviewKind::Image, "image/svg+xml"),
        "mp4" => (PreviewKind::Video, "video/mp4"),
        "webm" => (PreviewKind::Video, "video/webm"),
        "mov" => (PreviewKind::Video, "video/quicktime"),
        "m4v" => (PreviewKind::Video, "video/x-m4v"),
        "avi" => (PreviewKind::Video, "video/x-msvideo"),
        "mkv" => (PreviewKind::Video, "video/x-matroska"),
        "mp3" => (PreviewKind::Audio, "audio/mpeg"),
        "wav" => (PreviewKind::Audio, "audio/wav"),
        "m4a" => (PreviewKind::Audio, "audio/mp4"),
        "ogg" => (PreviewKind::Audio, "audio/ogg"),
        "flac" => (PreviewKind::Audio, "audio/flac"),
        "aac" => (PreviewKind::Audio, "audio/aac"),
        "ico" => (PreviewKind::Image, "image/x-icon"),
        "avif" => (PreviewKind::Image, "image/avif"),
        _ => return Err("file type is not allowed for preview".to_string()),
    };
    Ok(PreviewType { kind, mime })
}

fn read_limited(path: &Path, limit: u64) -> Result<(Vec<u8>, u64), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("failed to read metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("path is not a file".to_string());
    }
    if metadata.len() > limit {
        return Err(format!("file exceeds the {limit} byte limit"));
    }
    let bytes = fs::read(path).map_err(|error| format!("failed to read file: {error}"))?;
    Ok((bytes, metadata.len()))
}

fn preview_guarded(guard: &PathGuard, path: impl AsRef<Path>) -> Result<FilePreview, String> {
    let path = guard.resolve(path)?;
    let preview_type = classify_preview(&path)?;
    let limit = if preview_type.kind == PreviewKind::Text {
        TEXT_PREVIEW_LIMIT
    } else {
        FILE_READ_LIMIT
    };
    let (bytes, size) = read_limited(&path, limit)?;
    let (text, base64) = if preview_type.kind == PreviewKind::Text {
        let text = String::from_utf8_lossy(&bytes).into_owned();
        (Some(text), None)
    } else {
        (None, Some(STANDARD.encode(bytes)))
    };
    Ok(FilePreview {
        name: file_name(&path)?,
        path: display_path(&path),
        mime: preview_type.mime.to_string(),
        kind: preview_type.kind,
        text,
        base64,
        size,
    })
}

/// Quick links first (workspace folders, user folders), then every drive.
#[tauri::command]
pub fn workbench_files_roots() -> Vec<FileRoot> {
    let mut roots = Vec::new();
    let mut push = |name: &str, path: std::path::PathBuf| {
        if path.is_dir() {
            roots.push(FileRoot {
                name: name.to_string(),
                path: display_path(&path),
            });
        }
    };
    push("AIWorkstation", r"C:\AIWorkstation".into());
    push("GithubRepo", r"C:\GithubRepo".into());
    if let Some(dir) = dirs::download_dir() {
        push("Downloads", dir);
    }
    if let Some(dir) = dirs::desktop_dir() {
        push("Desktop", dir);
    }
    if let Some(dir) = dirs::document_dir() {
        push("Documents", dir);
    }
    if let Some(dir) = dirs::home_dir() {
        push("Home", dir);
    }
    for drive in drive_roots() {
        let label = drive.to_string_lossy().trim_end_matches('\\').to_string();
        push(&label, drive);
    }
    roots
}

#[tauri::command]
pub fn workbench_files_list(path: String) -> Result<Vec<FileEntry>, String> {
    let guard = PathGuard::default_roots()?;
    let directory = guard.resolve(path)?;
    if !directory.is_dir() {
        return Err("path is not a directory".to_string());
    }
    let mut entries = Vec::new();
    for item in
        fs::read_dir(directory).map_err(|error| format!("failed to list directory: {error}"))?
    {
        // Locked system files (pagefile.sys, junction loops…) are skipped
        // instead of failing the whole listing.
        let Ok(item) = item else { continue };
        let canonical = match guard.resolve(item.path()) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let Ok(metadata) = fs::metadata(&canonical) else {
            continue;
        };
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };
        let mime = if metadata.is_file() {
            classify_preview(&canonical)
                .ok()
                .map(|value| value.mime.to_string())
        } else {
            None
        };
        entries.push(FileEntry {
            name,
            path: display_path(&item.path()),
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            mime,
        });
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn workbench_files_preview(path: String) -> Result<FilePreview, String> {
    let guard = PathGuard::default_roots()?;
    preview_guarded(&guard, path)
}

#[tauri::command]
pub fn workbench_files_read(path: String) -> Result<FileRead, String> {
    let guard = PathGuard::default_roots()?;
    let path = guard.resolve(path)?;
    let mime = classify_preview(&path)
        .map(|preview_type| preview_type.mime)
        .unwrap_or("application/octet-stream");
    let (bytes, size) = read_limited(&path, FILE_READ_LIMIT)?;
    Ok(FileRead {
        name: file_name(&path)?,
        mime: mime.to_string(),
        base64: STANDARD.encode(bytes),
        size,
    })
}

#[tauri::command]
pub fn workbench_files_reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let guard = PathGuard::default_roots()?;
    let path = guard.resolve(path)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| format!("failed to reveal file: {error}"))
}

/// Open a file with its default Windows application (double-click in Files).
#[tauri::command]
pub fn workbench_files_open(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let guard = PathGuard::default_roots()?;
    let path = guard.resolve(path)?;
    app.opener()
        .open_path(display_path(&path), None::<&str>)
        .map_err(|error| format!("failed to open file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{classify_preview, preview_guarded, PreviewKind, FILE_COMMAND_NAMES};
    use crate::workbench::path_guard::PathGuard;
    use std::fs;

    #[test]
    fn classifies_only_allowed_preview_types() {
        assert_eq!(
            classify_preview("notes.md").unwrap().kind,
            PreviewKind::Text
        );
        assert_eq!(
            classify_preview("photo.png").unwrap().kind,
            PreviewKind::Image
        );
        assert_eq!(
            classify_preview("clip.mp4").unwrap().kind,
            PreviewKind::Video
        );
        assert!(classify_preview("archive.zip").is_err());
    }

    #[test]
    fn exposes_only_read_only_file_commands() {
        assert_eq!(
            FILE_COMMAND_NAMES,
            [
                "workbench_files_roots",
                "workbench_files_list",
                "workbench_files_preview",
                "workbench_files_read",
                "workbench_files_reveal",
            ]
        );
    }

    #[test]
    fn previews_allowed_text_from_inside_a_root() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("notes.md");
        fs::write(&file, "hello workbench").unwrap();
        let guard = PathGuard::new(vec![temp.path().to_path_buf()]).unwrap();

        let preview = preview_guarded(&guard, &file).unwrap();

        assert_eq!(preview.kind, PreviewKind::Text);
        assert_eq!(preview.text.as_deref(), Some("hello workbench"));
        assert!(preview.base64.is_none());
    }

    #[test]
    fn preview_rejects_an_allowed_extension_outside_the_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("outside.txt");
        fs::write(&file, "must not be read").unwrap();
        let guard = PathGuard::new(vec![root.path().to_path_buf()]).unwrap();

        assert!(preview_guarded(&guard, &file)
            .unwrap_err()
            .contains("outside"));
    }
}
