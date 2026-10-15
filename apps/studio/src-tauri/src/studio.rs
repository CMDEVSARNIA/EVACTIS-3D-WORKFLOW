//! Studio commands: projects, the media library and imports.
//!
//! The open project lives here, in Rust. The UI never passes a project path to a
//! library command, and the asset protocol (thumbnails, previews) is widened to the
//! open project's `media/` folder only. Nothing in this module touches the network.

use evx_core::project::{self, ProjectLocation};
use evx_media::{
    library::{self, AssetRecord},
    video::Ffmpeg,
    ImportOptions, MediaError, Progress, Stage,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, Manager, State, WebviewWindow};

/// Must list every command in `handler()` below; the desktop shell routes by name.
pub const COMMANDS: &[&str] = &[
    "project_create",
    "project_open",
    "project_save",
    "project_close",
    "library_list",
    "media_import",
    "media_cancel",
    "media_remove",
    "media_tools",
    "pick_folder",
    "pick_project",
    "pick_media",
    "smoke_workspace",
];

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        project_create,
        project_open,
        project_save,
        project_close,
        library_list,
        media_import,
        media_cancel,
        media_remove,
        media_tools,
        pick_folder,
        pick_project,
        pick_media,
        smoke_workspace,
    ]
}

#[derive(Default)]
pub struct Studio {
    project: Mutex<Option<ProjectLocation>>,
    jobs: Mutex<HashMap<u32, Arc<AtomicBool>>>,
    next_job: AtomicU32,
    smoke: bool,
}

impl Studio {
    pub fn new(smoke: bool) -> Self {
        Self { smoke, ..Default::default() }
    }

    fn root(&self) -> Result<PathBuf, CommandError> {
        self.project
            .lock()
            .unwrap()
            .as_ref()
            .map(|p| p.root.clone())
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
    fn new(code: &'static str, message: impl Into<String>) -> Self {
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
    let loc = state.project.lock().unwrap().clone();
    let loc = loc.ok_or_else(|| CommandError::new("no-project", "No project is open"))?;
    project::save_manifest(&loc, manifest.as_bytes()).map_err(CommandError::project)
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
    on_event: Channel<ImportEvent>,
) -> Result<u32, CommandError> {
    let root = state.root()?;
    let job = state.next_job.fetch_add(1, Ordering::Relaxed);
    let cancel = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(job, cancel.clone());
    let opts = ImportOptions { ffmpeg: find_ffmpeg(&app), ..Default::default() };
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

fn path_string(p: impl AsRef<Path>) -> String {
    p.as_ref().display().to_string()
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
async fn pick_media(window: WebviewWindow, title: String, filter: String) -> Vec<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(title)
        .add_filter(filter, MEDIA_EXTENSIONS)
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
