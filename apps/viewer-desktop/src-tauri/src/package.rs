//! The environment the Viewer shows: a `.evx` package, from
//! - the file Explorer asked us to open (double-click; the `.evx` file association),
//! - `viewer.json` beside the executable (portable folders and per-facility installs),
//! - or a file the reader picks.
//!
//! Every file in it is checked against its SHA-256 when it opens; the UI then asks for
//! files one at a time (checked again) and decrypts them in memory itself, with the same
//! code the browser packages use. Nothing is written anywhere, nothing goes on a network.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use evx_package::Package;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, AppHandle, State, WebviewWindow};

pub const COMMANDS: &[&str] = &["viewer_package", "package_read", "pick_package"];

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![viewer_package, package_read, pick_package]
}

#[derive(Default)]
pub struct Viewer {
    package: Mutex<Option<Package>>,
}

/// `viewer.json`, written by the packager beside the executable.
#[derive(Deserialize)]
struct Delivery {
    environment: String,
    #[serde(default)]
    kiosk: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    path: String,
    kind: String,
    title: std::collections::HashMap<String, String>,
    encrypted: bool,
    kiosk: bool,
    files: usize,
}

/// The delivery beside the executable, if this is a portable folder or an install.
fn beside_exe() -> Option<(PathBuf, bool)> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let text = std::fs::read_to_string(dir.join("viewer.json")).ok()?;
    let d: Delivery = serde_json::from_str(&text).ok()?;
    let name = Path::new(&d.environment);
    // Only a plain file name beside the executable.
    if name.components().count() != 1 || name.extension().and_then(|e| e.to_str()) != Some("evx") {
        return None;
    }
    Some((dir.join(name), d.kiosk))
}

/// Opens (and fully checks) the package: `path` if given, else the launch file, else the
/// one beside the executable. `None` when there is nothing to open.
#[tauri::command]
fn viewer_package(
    state: State<'_, Viewer>,
    path: Option<String>,
    launch: State<'_, Launch>,
) -> Result<Option<Opened>, String> {
    let (file, kiosk) = match path.map(PathBuf::from).or_else(|| launch.0.clone()) {
        Some(p) => (p, false),
        None => match beside_exe() {
            Some(x) => x,
            None => return Ok(None),
        },
    };
    let mut pkg = Package::open(&file).map_err(|e| e.to_string())?;
    pkg.verify_all(|_, _| {}).map_err(|e| e.to_string())?;
    let opened = Opened {
        path: file.display().to_string(),
        kind: pkg.manifest.kind.clone(),
        title: pkg.manifest.environment.title.clone(),
        encrypted: pkg.encrypted(),
        kiosk,
        files: pkg.manifest.files.len(),
    };
    *state.package.lock().unwrap() = Some(pkg);
    Ok(Some(opened))
}

/// The stored bytes of one package file (checked again); the manifest by its own name.
#[tauri::command]
fn package_read(state: State<'_, Viewer>, path: String) -> Result<Response, String> {
    let mut guard = state.package.lock().unwrap();
    let pkg = guard.as_mut().ok_or("no package is open")?;
    let data = if path == evx_package::MANIFEST_PATH { pkg.manifest_bytes() } else { pkg.stored(&path) }
        .map_err(|e| e.to_string())?;
    Ok(Response::new(data))
}

#[tauri::command]
async fn pick_package(window: WebviewWindow, title: String, filter: String) -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(title)
        .add_filter(filter, &["evx"])
        .pick_file()
        .await
        .map(|h| h.path().display().to_string())
}

/// The file the Viewer was launched with (double-click on a `.evx`).
pub struct Launch(pub Option<PathBuf>);

pub fn manage(app: &AppHandle) {
    use tauri::Manager;
    let open = evx_core::launch::parse(std::env::args().skip(1)).open;
    app.manage(Viewer::default());
    app.manage(Launch(open));
}
