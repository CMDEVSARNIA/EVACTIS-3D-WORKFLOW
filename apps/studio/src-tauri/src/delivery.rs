//! Delivery packages made in Studio (Package dialog): the UI builds each package with
//! @evactis-3dworkflow/packaging and writes it here, file by file, into a folder the
//! author picked. Studio also brings what the desktop kinds need: the 3DWORKFLOW Viewer
//! program, an optional fixed WebView2 runtime or Microsoft's offline WebView2
//! installer, and the NSIS compiler for per-facility installers. Nothing here touches the network; makensis runs on local files only.

use std::{
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};

use crate::studio::{percent_decode, safe_file_name, CommandError, Studio};

pub const VIEWER_EXE: &str = "EVACTIS-3DWORKFLOW-Viewer.exe";
pub const WEBVIEW2_INSTALLER: &str = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe";

/// What Studio can bring to a package. Installed Studio carries them in its resources
/// (`viewer/`, `webview2/`, `webview2-installer/`, `nsis/`); development builds find the Viewer beside the
/// Studio executable (same Cargo target folder), and NSIS on PATH (or EVX_MAKENSIS).
struct Tools {
    viewer: Option<PathBuf>,
    viewer_icon: Option<PathBuf>,
    webview2: Option<PathBuf>,
    webview2_installer: Option<PathBuf>,
    makensis: Option<PathBuf>,
}

fn existing(p: PathBuf) -> Option<PathBuf> {
    p.is_file().then_some(p)
}

fn on_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(name)).find(|p| p.is_file())
}

fn tools(app: &AppHandle) -> Tools {
    let res = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    let exe = if cfg!(windows) { ".exe" } else { "" };
    let viewer = res
        .as_ref()
        .and_then(|r| existing(r.join("viewer").join(VIEWER_EXE)))
        .or_else(|| std::env::var_os("EVX_VIEWER_EXE").map(PathBuf::from).and_then(existing))
        .or_else(|| exe_dir.as_ref().and_then(|d| existing(d.join(format!("EVACTIS-3DWORKFLOW-Viewer{exe}")))));
    let viewer_icon = res.as_ref().and_then(|r| existing(r.join("viewer").join("icon.ico"))).or_else(|| {
        // Development: the Viewer's own icon in the repository.
        exe_dir.as_ref().and_then(|d| {
            d.ancestors().find_map(|a| existing(a.join("apps/viewer-desktop/src-tauri/icons/icon.ico")))
        })
    });
    let webview2 = res
        .as_ref()
        .map(|r| r.join("webview2"))
        .filter(|d| d.join("msedgewebview2.exe").is_file());
    let webview2_installer = res.as_ref().and_then(|r| existing(r.join("webview2-installer").join(WEBVIEW2_INSTALLER)));
    let makensis = res
        .as_ref()
        .and_then(|r| existing(r.join("nsis").join(format!("makensis{exe}"))))
        .or_else(|| std::env::var_os("EVX_MAKENSIS").map(PathBuf::from).and_then(existing))
        .or_else(|| on_path(&format!("makensis{exe}")));
    Tools { viewer, viewer_icon, webview2, webview2_installer, makensis }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageTools {
    viewer: bool,
    /// A fixed WebView2 runtime (portable viewers and installers carry it).
    webview2: bool,
    /// Microsoft's offline WebView2 installer (installers run it on PCs without one).
    webview2_installer: bool,
    nsis: bool,
}

#[tauri::command]
pub fn package_tools(app: AppHandle) -> PackageTools {
    let t = tools(&app);
    PackageTools {
        viewer: t.viewer.is_some(),
        webview2: t.webview2.is_some(),
        webview2_installer: t.webview2_installer.is_some(),
        nsis: t.makensis.is_some(),
    }
}

/// Bytes of a bundled file: `viewer` (the Viewer program) or `viewer-icon`.
#[tauri::command]
pub fn package_bundled(app: AppHandle, name: String) -> Result<Response, CommandError> {
    let t = tools(&app);
    let path = match name.as_str() {
        "viewer" => t.viewer,
        "viewer-icon" => t.viewer_icon,
        _ => None,
    }
    .ok_or_else(|| CommandError::new("missing-tool", format!("{name} is not bundled with this Studio")))?;
    std::fs::read(path).map(Response::new).map_err(|e| CommandError::new("io", e.to_string()))
}

/// A folder picked for export in this session, and a relative path inside it made of
/// safe names only.
fn target(state: &Studio, dir: &str, rel: &str) -> Result<PathBuf, CommandError> {
    let dir = PathBuf::from(dir);
    if !state.export_dir_allowed(&dir) {
        return Err(CommandError::new("invalid", format!("{} was not chosen for export", dir.display())));
    }
    if rel.is_empty() || !rel.split('/').all(safe_file_name) {
        return Err(CommandError::new("invalid", format!("not a package path: {rel}")));
    }
    Ok(rel.split('/').fold(dir, |p, c| p.join(c)))
}

/// Refuses to start when any top-level output already exists: a package never
/// overwrites earlier work.
#[tauri::command]
pub fn package_target(state: State<'_, Studio>, dir: String, outputs: Vec<String>) -> Result<(), CommandError> {
    for o in &outputs {
        let p = target(&state, &dir, o)?;
        if p.exists() {
            return Err(CommandError::new("exists", p.display().to_string()));
        }
    }
    Ok(())
}

/// Writes (or appends to) one package file. Raw body = the bytes; headers `x-evx-dir`
/// (the picked folder) and `x-evx-path` (relative, `/`-separated), percent-encoded
/// UTF-8, and `x-evx-append: 1` to append.
#[tauri::command]
pub fn package_write(state: State<'_, Studio>, request: Request<'_>) -> Result<(), CommandError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new("invalid", "expected the file bytes"));
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(percent_decode)
            .ok_or_else(|| CommandError::new("invalid", format!("missing {name}")))
    };
    let (dir, rel) = (header("x-evx-dir")?, header("x-evx-path")?);
    let path = target(&state, &dir, &rel)?;
    let top = target(&state, &dir, rel.split('/').next().unwrap_or_default())?;
    if !top.exists() {
        state.package_outputs.lock().unwrap().insert(top);
    }
    let append = request.headers().get("x-evx-append").is_some_and(|v| v == "1");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CommandError::new("io", e.to_string()))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&path)
        .map_err(|e| CommandError::new("io", e.to_string()))?;
    f.write_all(bytes).map_err(|e| CommandError::new("io", e.to_string()))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Removes the outputs of a package that failed: only what `package_write` created in
/// this session, never anything that was there before.
#[tauri::command]
pub fn package_discard(state: State<'_, Studio>, dir: String, outputs: Vec<String>) -> Result<(), CommandError> {
    for o in &outputs {
        let p = target(&state, &dir, o)?;
        if !state.package_outputs.lock().unwrap().remove(&p) {
            continue;
        }
        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        r.or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) })
            .map_err(|e| CommandError::new("io", e.to_string()))?;
    }
    Ok(())
}

/// Copies the bundled WebView2 into `<dir>/<folder>/`: `runtime` (the fixed runtime, into
/// `webview2/`) or `installer` (the offline installer, beside the installer script).
#[tauri::command]
pub async fn package_webview2(
    app: AppHandle,
    state: State<'_, Studio>,
    dir: String,
    folder: String,
    what: String,
) -> Result<(), CommandError> {
    let t = tools(&app);
    let base = target(&state, &dir, &folder)?;
    let (from, to, is_dir) = match what.as_str() {
        "runtime" => (t.webview2, base.join("webview2"), true),
        "installer" => (t.webview2_installer, base.join(WEBVIEW2_INSTALLER), false),
        _ => (None, base, false),
    };
    let from = from.ok_or_else(|| CommandError::new("missing-tool", format!("WebView2 {what}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        if is_dir {
            copy_dir(&from, &to)
        } else {
            std::fs::copy(&from, &to).map(|_| ())
        }
    })
        .await
        .map_err(|e| CommandError::new("io", e.to_string()))?
        .map_err(|e| CommandError::new("io", e.to_string()))
}

/// Compiles `<dir>/<folder>/installer.nsi` (written by the packager) into
/// `<dir>/<folder> Setup.exe`, then removes the staging folder. Returns the setup path.
#[tauri::command]
pub async fn package_installer(
    app: AppHandle,
    state: State<'_, Studio>,
    dir: String,
    folder: String,
) -> Result<String, CommandError> {
    let makensis = tools(&app).makensis.ok_or_else(|| CommandError::new("missing-tool", "NSIS"))?;
    let staging = target(&state, &dir, &folder)?;
    let setup = target(&state, &dir, &format!("{folder} Setup.exe"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(makensis);
        cmd.args(["-V2", "-NOCD", "installer.nsi"]).current_dir(&staging);
        // The Linux makensis crashes on accented file names under the POSIX locale.
        cmd.env("LC_ALL", "C.UTF-8");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let out = cmd.output().map_err(|e| CommandError::new("io", e.to_string()))?;
        if !out.status.success() || !setup.is_file() {
            let log = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
            return Err(CommandError::new("installer", log.trim().lines().rev().take(8).collect::<Vec<_>>().join("\n")));
        }
        std::fs::remove_dir_all(&staging).map_err(|e| CommandError::new("io", e.to_string()))?;
        Ok(setup.display().to_string())
    })
    .await
    .map_err(|e| CommandError::new("io", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_paths_stay_inside_the_picked_folder() {
        let state = Studio::new(false);
        let dir = std::env::temp_dir();
        state.allow_export_dir(dir.clone());
        let d = dir.display().to_string();
        assert!(target(&state, &d, "Riverside/media/a/b.jpg").is_ok());
        assert!(target(&state, &d, "Riverside Setup.exe").is_ok());
        for bad in ["", "../x", "a/../b", "a//b", "/abs", "a\\b", ".hidden", "a/.evx/b", "c:x"] {
            assert!(target(&state, &d, bad).is_err(), "{bad}");
        }
        assert!(target(&state, "/not/picked", "a").is_err());
    }
}
