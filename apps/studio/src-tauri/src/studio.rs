//! Studio commands: projects, the media library and imports.
//!
//! The open project lives here, in Rust. The UI never passes a project path to a
//! library command, and the asset protocol (thumbnails, previews) is widened to the
//! open project's `media/` folder only. Nothing in this module touches the network.

use evx_core::{
    history::{self, Snapshot, SnapshotKind},
    project::{self, ProjectLocation},
};
use evx_media::{
    library::{self, AssetRecord},
    video::Ffmpeg,
    ImportOptions, MediaError, Progress, Purpose, Stage,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    ipc::{Channel, InvokeBody, Request, Response},
    AppHandle, Manager, State, WebviewWindow,
};

/// Must list every command in `handler()` below; the desktop shell routes by name.
pub const COMMANDS: &[&str] = &[
    "project_create",
    "project_open",
    "project_save",
    "project_close",
    "project_snapshot",
    "project_snapshots",
    "project_snapshot_read",
    "project_restore",
    "library_list",
    "media_import",
    "media_cancel",
    "media_remove",
    "media_tools",
    "pick_folder",
    "pick_project",
    "pick_media",
    "smoke_workspace",
    "project_read_media",
    "pick_save",
    "pick_export_folder",
    "export_file",
    "package_tools",
    "package_bundled",
    "package_target",
    "package_write",
    "package_webview2",
    "package_installer",
    "package_discard",
    "media_sizes",
];

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        project_create,
        project_open,
        project_save,
        project_close,
        project_snapshot,
        project_snapshots,
        project_snapshot_read,
        project_restore,
        library_list,
        media_import,
        media_cancel,
        media_remove,
        media_tools,
        pick_folder,
        pick_project,
        pick_media,
        smoke_workspace,
        project_read_media,
        pick_save,
        pick_export_folder,
        export_file,
        crate::delivery::package_tools,
        crate::delivery::package_bundled,
        crate::delivery::package_target,
        crate::delivery::package_write,
        crate::delivery::package_webview2,
        crate::delivery::package_installer,
        crate::delivery::package_discard,
        media_sizes,
    ]
}

#[derive(Default)]
pub struct Studio {
    project: Mutex<Option<ProjectLocation>>,
    jobs: Mutex<HashMap<u32, Arc<AtomicBool>>>,
    next_job: AtomicU32,
    smoke: bool,
    /// Where the UI may write exports: files the user picked in a save dialog and
    /// folders picked for an export, in this session only.
    export_files: Mutex<HashSet<PathBuf>>,
    export_dirs: Mutex<HashSet<PathBuf>>,
    /// Package outputs (top-level files and folders) created by `package_write` in this
    /// session: the only things `package_discard` may remove.
    pub(crate) package_outputs: Mutex<HashSet<PathBuf>>,
}

impl Studio {
    pub fn new(smoke: bool) -> Self {
        Self { smoke, ..Default::default() }
    }

    pub(crate) fn export_dir_allowed(&self, dir: &Path) -> bool {
        self.export_dirs.lock().unwrap().contains(dir)
    }

    #[cfg(test)]
    pub(crate) fn allow_export_dir(&self, dir: PathBuf) {
        self.export_dirs.lock().unwrap().insert(dir);
    }

    fn root(&self) -> Result<PathBuf, CommandError> {
        self.location().map(|p| p.root)
    }

    fn location(&self) -> Result<ProjectLocation, CommandError> {
        self.project
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| CommandError::new("no-project", "No project is open"))
    }
}

/// Errors carry a stable code; Studio shows a localised message for each.
#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    fn project(message: String) -> Self {
        Self::new("project", message)
    }
}

impl From<MediaError> for CommandError {
    fn from(e: MediaError) -> Self {
        Self::new(e.code(), e.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    name: String,
    root: String,
    manifest_path: String,
    /// The environment JSON, validated by the UI with the schema package.
    manifest: String,
}

fn activate(app: &AppHandle, state: &Studio, loc: ProjectLocation) -> Result<ProjectInfo, CommandError> {
    let manifest = std::fs::read_to_string(&loc.manifest).map_err(|e| CommandError::project(e.to_string()))?;
    // Leftovers from an import that was killed (power cut, crash) are never valid.
    let _ = library::clean_staging(&loc.root);
    // A version of the project as it was opened, unless the newest one already matches.
    // History is a convenience: a read-only or full disk must not block opening.
    if history::take(&loc, "Opened", SnapshotKind::Auto, &library::now_iso()).is_ok() {
        let _ = history::prune_auto(&loc, AUTO_SNAPSHOTS_KEPT);
    }
    let media = library::media_dir(&loc.root);
    std::fs::create_dir_all(&media).map_err(|e| CommandError::project(e.to_string()))?;
    app.asset_protocol_scope()
        .allow_directory(&media, true)
        .map_err(|e| CommandError::project(e.to_string()))?;
    let info = ProjectInfo {
        name: loc.manifest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
        root: loc.root.display().to_string(),
        manifest_path: loc.manifest.display().to_string(),
        manifest,
    };
    *state.project.lock().unwrap() = Some(loc);
    Ok(info)
}

/// Automatic versions kept per project; manual and "before restore" ones are kept.
const AUTO_SNAPSHOTS_KEPT: usize = 30;

fn check_json(manifest: &str) -> Result<(), CommandError> {
    serde_json::from_str::<serde_json::Value>(manifest)
        .map(|_| ())
        .map_err(|e| CommandError::project(format!("manifest is not valid JSON: {e}")))
}

#[tauri::command]
fn project_create(
    app: AppHandle,
    state: State<'_, Studio>,
    parent: String,
    name: String,
    manifest: String,
) -> Result<ProjectInfo, CommandError> {
    check_json(&manifest)?;
    let loc = project::create(Path::new(&parent), &name, manifest.as_bytes()).map_err(CommandError::project)?;
    activate(&app, &state, loc)
}

#[tauri::command]
fn project_open(app: AppHandle, state: State<'_, Studio>, path: String) -> Result<ProjectInfo, CommandError> {
    let loc = project::locate(Path::new(&path)).map_err(CommandError::project)?;
    activate(&app, &state, loc)
}

#[tauri::command]
fn project_save(state: State<'_, Studio>, manifest: String) -> Result<(), CommandError> {
    check_json(&manifest)?;
    project::save_manifest(&state.location()?, manifest.as_bytes()).map_err(CommandError::project)
}

/// Saves a version of the project as last saved. Automatic versions (taken by Studio
/// while editing) are skipped when nothing changed and pruned to the newest few.
#[tauri::command]
fn project_snapshot(state: State<'_, Studio>, label: String, auto: bool) -> Result<Option<Snapshot>, CommandError> {
    let loc = state.location()?;
    let kind = if auto { SnapshotKind::Auto } else { SnapshotKind::Manual };
    let snap = history::take(&loc, &label, kind, &library::now_iso()).map_err(CommandError::project)?;
    if auto {
        history::prune_auto(&loc, AUTO_SNAPSHOTS_KEPT).map_err(CommandError::project)?;
    }
    Ok(snap)
}

#[tauri::command]
fn project_snapshots(state: State<'_, Studio>) -> Result<Vec<Snapshot>, CommandError> {
    history::list(&state.location()?).map_err(CommandError::project)
}

/// A version's manifest, so the UI can validate it before restoring.
#[tauri::command]
fn project_snapshot_read(state: State<'_, Studio>, id: String) -> Result<String, CommandError> {
    let bytes = history::read(&state.location()?, &id).map_err(CommandError::project)?;
    String::from_utf8(bytes).map_err(|_| CommandError::project("the version is not UTF-8 text".into()))
}

/// Replaces the project with a version, after saving the current state as a
/// "before restore" version so the restore itself can be undone. Returns the manifest.
#[tauri::command]
fn project_restore(state: State<'_, Studio>, id: String, label: String) -> Result<String, CommandError> {
    let loc = state.location()?;
    let text = project_snapshot_read(state, id)?;
    check_json(&text)?;
    history::take(&loc, &label, SnapshotKind::BeforeRestore, &library::now_iso()).map_err(CommandError::project)?;
    project::save_manifest(&loc, text.as_bytes()).map_err(CommandError::project)?;
    Ok(text)
}

#[tauri::command]
fn project_close(state: State<'_, Studio>) {
    for cancel in state.jobs.lock().unwrap().values() {
        cancel.store(true, Ordering::Relaxed);
    }
    *state.project.lock().unwrap() = None;
}

#[derive(Serialize)]
pub struct LibraryListing {
    assets: Vec<AssetRecord>,
    problems: Vec<String>,
}

#[tauri::command]
fn library_list(state: State<'_, Studio>) -> Result<LibraryListing, CommandError> {
    let l = library::list(&state.root()?)?;
    Ok(LibraryListing { assets: l.assets, problems: l.problems })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum ImportEvent {
    Started { index: usize, path: String },
    Progress { index: usize, stage: Stage, done: u64, total: u64 },
    Imported { index: usize, asset: Box<AssetRecord> },
    Failed { index: usize, path: String, code: &'static str, message: String },
    Finished { imported: usize, failed: usize, cancelled: bool },
}

/// The bundled LGPL ffmpeg sits in `<install>/ffmpeg/`; development builds fall back
/// to EVX_FFMPEG_DIR or PATH.
fn find_ffmpeg(app: &AppHandle) -> Option<Ffmpeg> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("ffmpeg"));
    Ffmpeg::locate(bundled.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTools {
    ffmpeg_version: Option<String>,
    /// False for a GPL/non-free build (fine to use locally, not to redistribute).
    ffmpeg_redistributable: Option<bool>,
}

#[tauri::command]
fn media_tools(app: AppHandle) -> MediaTools {
    let build = find_ffmpeg(&app).and_then(|f| f.build().ok());
    MediaTools {
        ffmpeg_version: build.as_ref().map(|b| b.version.clone()),
        ffmpeg_redistributable: build.map(|b| b.redistributable()),
    }
}

/// Imports files one after another on a background thread; returns a job ID for
/// `media_cancel`. Progress is throttled to ~10 events per second per file.
#[tauri::command]
fn media_import(
    app: AppHandle,
    state: State<'_, Studio>,
    paths: Vec<String>,
    purpose: Option<Purpose>,
    on_event: Channel<ImportEvent>,
) -> Result<u32, CommandError> {
    let root = state.root()?;
    let job = state.next_job.fetch_add(1, Ordering::Relaxed);
    let cancel = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(job, cancel.clone());
    let purpose = purpose.unwrap_or_default();
    let ffmpeg = if purpose == Purpose::Scene { find_ffmpeg(&app) } else { None };
    let opts = ImportOptions { purpose, ffmpeg, ..Default::default() };
    std::thread::spawn(move || {
        let (mut imported, mut failed) = (0, 0);
        for (index, path) in paths.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let _ = on_event.send(ImportEvent::Started { index, path: path.clone() });
            let last = Mutex::new((Instant::now() - Duration::from_secs(1), None::<Stage>));
            let progress = |p: Progress| {
                let mut l = last.lock().unwrap();
                let now = Instant::now();
                if l.1 != Some(p.stage) || p.done >= p.total || now - l.0 >= Duration::from_millis(100) {
                    *l = (now, Some(p.stage));
                    let _ = on_event.send(ImportEvent::Progress { index, stage: p.stage, done: p.done, total: p.total });
                }
            };
            match evx_media::import_file(&root, Path::new(path), &opts, &cancel, &progress) {
                Ok(asset) => {
                    imported += 1;
                    let _ = on_event.send(ImportEvent::Imported { index, asset: Box::new(asset) });
                }
                Err(e) => {
                    failed += 1;
                    let _ = on_event.send(ImportEvent::Failed {
                        index,
                        path: path.clone(),
                        code: e.code(),
                        message: e.to_string(),
                    });
                }
            }
        }
        let cancelled = cancel.load(Ordering::Relaxed);
        let _ = on_event.send(ImportEvent::Finished { imported, failed, cancelled });
        if let Some(state) = app.try_state::<Studio>() {
            state.jobs.lock().unwrap().remove(&job);
        }
    });
    Ok(job)
}

#[tauri::command]
fn media_cancel(state: State<'_, Studio>, job: u32) {
    if let Some(c) = state.jobs.lock().unwrap().get(&job) {
        c.store(true, Ordering::Relaxed);
    }
}

/// Phase 4 adds the "still used by a scene" check before this is offered in the UI
/// for assets that scenes reference.
#[tauri::command]
fn media_remove(state: State<'_, Studio>, id: String) -> Result<(), CommandError> {
    library::remove(&state.root()?, &id)?;
    Ok(())
}

const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "tif", "tiff", "hdr", "mp4", "mov", "m4v", "mkv", "webm", "glb", "ply", "splat", "ksplat", "spz",
    // Insta360 originals: accepted by the picker so Studio can explain the export step.
    "insp", "insv",
];

/// Floor plans: raster images (evx_media::probe::probe_plan). PDF is offered too, so
/// Studio can explain the export step instead of hiding the file.
const PLAN_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tif", "tiff", "pdf"];
const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "ogg", "oga", "opus", "m4a", "aac", "flac"];
const DOCUMENT_EXTENSIONS: &[&str] = &["pdf"];
const PHOTO_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "tif", "tiff"];

fn path_string(p: impl AsRef<Path>) -> String {
    p.as_ref().display().to_string()
}

/// Bytes of a file in the open project's media folder (floor plans for printing).
/// Paths are relative (`media/<id>/<file>`) and may not leave that folder.
#[tauri::command]
fn project_read_media(state: State<'_, Studio>, path: String) -> Result<Response, CommandError> {
    let root = state.root()?;
    let bad = || CommandError::new("invalid", format!("not a project media path: {path}"));
    if !path.starts_with("media/") || path.contains('\\') || path.split('/').any(|p| p == ".." || p.is_empty()) {
        return Err(bad());
    }
    let media = library::media_dir(&root).canonicalize().map_err(|e| CommandError::project(e.to_string()))?;
    let file = root.join(&path).canonicalize().map_err(|_| bad())?;
    if !file.starts_with(&media) || !file.is_file() {
        return Err(bad());
    }
    std::fs::read(&file).map(Response::new).map_err(|e| CommandError::new("io", e.to_string()))
}

/// Sizes in bytes of project media files (same paths and rules as `project_read_media`);
/// Studio estimates a package's size from them before making it.
#[tauri::command]
fn media_sizes(state: State<'_, Studio>, paths: Vec<String>) -> Result<Vec<u64>, CommandError> {
    let root = state.root()?;
    let media = library::media_dir(&root).canonicalize().map_err(|e| CommandError::project(e.to_string()))?;
    paths
        .iter()
        .map(|path| {
            let bad = || CommandError::new("invalid", format!("not a project media path: {path}"));
            if !path.starts_with("media/") || path.contains('\\') || path.split('/').any(|p| p == ".." || p.is_empty()) {
                return Err(bad());
            }
            let file = root.join(path).canonicalize().map_err(|_| bad())?;
            if !file.starts_with(&media) {
                return Err(bad());
            }
            file.metadata().map(|m| m.len()).map_err(|_| bad())
        })
        .collect()
}

/// Save dialog for an export; the chosen file becomes writable by `export_file`.
#[tauri::command]
async fn pick_save(
    window: WebviewWindow,
    state: State<'_, Studio>,
    title: String,
    default_name: String,
    filter: String,
    extension: String,
) -> Result<Option<String>, CommandError> {
    let picked = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(default_name)
        .add_filter(filter, &[extension.as_str()])
        .save_file()
        .await
        .map(|h| h.path().to_path_buf());
    if let Some(p) = &picked {
        state.export_files.lock().unwrap().insert(p.clone());
    }
    Ok(picked.map(path_string))
}

/// Folder dialog for a multi-file export (one PDF per floor and posting).
#[tauri::command]
async fn pick_export_folder(
    window: WebviewWindow,
    state: State<'_, Studio>,
    title: String,
) -> Result<Option<String>, CommandError> {
    let picked = rfd::AsyncFileDialog::new().set_parent(&window).set_title(title).pick_folder().await;
    let dir = picked.map(|h| h.path().to_path_buf());
    if let Some(d) = &dir {
        state.export_dirs.lock().unwrap().insert(d.clone());
    }
    Ok(dir.map(path_string))
}

/// File names Studio writes into an export folder: no separators, no dot-names.
pub(crate) fn safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 180
        && !name.starts_with('.')
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
}

/// Writes an export (raw body = file bytes). The target must be a file picked in a save
/// dialog, or a safe name inside a folder picked for export, in this session.
/// Header `x-evx-path`: the target path, percent-encoded UTF-8.
#[tauri::command]
fn export_file(state: State<'_, Studio>, request: Request<'_>) -> Result<String, CommandError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new("invalid", "expected the file bytes"));
    };
    let encoded = request
        .headers()
        .get("x-evx-path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| CommandError::new("invalid", "missing target path"))?;
    let path = PathBuf::from(percent_decode(encoded).ok_or_else(|| CommandError::new("invalid", "bad target path"))?);
    let allowed = state.export_files.lock().unwrap().contains(&path)
        || (path.parent().is_some_and(|d| state.export_dirs.lock().unwrap().contains(d))
            && path.file_name().and_then(|n| n.to_str()).is_some_and(safe_file_name));
    if !allowed {
        return Err(CommandError::new("invalid", format!("{} was not chosen for export", path.display())));
    }
    let tmp = path.with_extension("evx-partial");
    std::fs::write(&tmp, bytes)
        .and_then(|_| std::fs::rename(&tmp, &path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            CommandError::new("io", e.to_string())
        })?;
    Ok(path_string(&path))
}

pub(crate) fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[tauri::command]
async fn pick_folder(window: WebviewWindow, title: String) -> Option<String> {
    rfd::AsyncFileDialog::new().set_parent(&window).set_title(title).pick_folder().await.map(|h| path_string(h.path()))
}

#[tauri::command]
async fn pick_project(window: WebviewWindow, title: String, filter: String) -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(title)
        .add_filter(filter, &[evx_core::identity::PROJECT_EXT])
        .pick_file()
        .await
        .map(|h| path_string(h.path()))
}

#[tauri::command]
async fn pick_media(window: WebviewWindow, title: String, filter: String, purpose: Option<Purpose>) -> Vec<String> {
    let extensions = match purpose.unwrap_or_default() {
        Purpose::Scene => MEDIA_EXTENSIONS,
        Purpose::FloorPlan => PLAN_EXTENSIONS,
        Purpose::Audio => AUDIO_EXTENSIONS,
        Purpose::Document => DOCUMENT_EXTENSIONS,
        Purpose::Photo => PHOTO_EXTENSIONS,
    };
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(title)
        .add_filter(filter, extensions)
        .pick_files()
        .await
        .unwrap_or_default()
        .iter()
        .map(|h| path_string(h.path()))
        .collect()
}

/// Smoke-test runs only: an empty scratch folder for the import check.
#[tauri::command]
fn smoke_workspace(state: State<'_, Studio>) -> Result<String, CommandError> {
    if !state.smoke {
        return Err(CommandError::new("smoke", "Only available in smoke-test runs"));
    }
    let dir = std::env::temp_dir().join(format!("evx-studio-smoke-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::project(e.to_string()))?;
    Ok(path_string(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_names_and_paths() {
        assert!(safe_file_name("Evacuation plan - Ground floor - letter.pdf"));
        assert!(safe_file_name("Plan d’évacuation – Rez-de-chaussée.pdf"));
        for bad in ["", "../x.pdf", "a/b.pdf", "a\\b.pdf", ".hidden", "c:x", "x?.pdf", "nul\u{0}"] {
            assert!(!safe_file_name(bad), "{bad}");
        }
        assert_eq!(percent_decode("C%3A%5CPlans%5CR%C3%A9sum%C3%A9.pdf").unwrap(), "C:\\Plans\\Résumé.pdf");
        assert!(percent_decode("%zz").is_none());
    }
}
