//! Tauri shell shared by Studio and Viewer.
//!
//! - creates the main window and refuses navigation to anything but bundled content
//! - exposes `app_info` (name, version, file to open) to the UI
//! - implements `--smoke-test <report.json>` for the Windows install smoke test
//! - routes app-specific commands (e.g. Studio's media library) to the app's handler

use std::{path::PathBuf, time::Duration};

use evx_core::{identity::PUBLISHER, launch, net, smoke::SmokeReport};
use serde::Serialize;
use tauri::{ipc::Invoke, AppHandle, State, WebviewUrl, WebviewWindowBuilder, Wry};

/// Makes `Object.prototype` immutable before any page script runs; replaces Tauri's
/// `freezePrototype`, which breaks pdf-lib (see the script and ADR 0016).
const HARDEN: &str = include_str!("harden.js");

/// Per-app window settings.
pub struct AppSpec {
    /// Full product name, e.g. "EVACTIS 3DWORKFLOW Studio" (window title, reports).
    pub name: &'static str,
    pub width: f64,
    pub height: f64,
}

struct Launch {
    name: &'static str,
    args: launch::LaunchArgs,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: String,
    publisher: &'static str,
    identifier: String,
    open_path: Option<String>,
    smoke_test: bool,
    smoke_import: Option<String>,
}

#[tauri::command]
fn app_info(app: AppHandle, launch: State<'_, Launch>) -> AppInfo {
    AppInfo {
        name: launch.name,
        version: app.package_info().version.to_string(),
        publisher: PUBLISHER,
        identifier: app.config().identifier.clone(),
        open_path: launch.args.open.as_ref().map(|p| p.display().to_string()),
        smoke_test: launch.args.smoke_test.is_some(),
        smoke_import: launch.args.smoke_import.as_ref().map(|p| p.display().to_string()),
    }
}

/// Called by the UI once it has rendered. Outside smoke-test mode this is a no-op.
#[tauri::command]
fn smoke_report(
    app: AppHandle,
    launch: State<'_, Launch>,
    user_agent: String,
    location: String,
    blocked_requests: Vec<String>,
    checks: Option<Vec<String>>,
    error: Option<String>,
) -> Result<(), String> {
    let Some(path) = launch.args.smoke_test.as_ref() else { return Ok(()) };
    let report = SmokeReport {
        app: launch.name.into(),
        version: app.package_info().version.to_string(),
        ui_ready: true,
        user_agent,
        location,
        blocked_requests,
        error,
        checks: checks.unwrap_or_default(),
    };
    report.write(path).map_err(|e| e.to_string())?;
    app.exit(if report.passed() { 0 } else { 1 });
    Ok(())
}

fn shared_handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![app_info, smoke_report]
}

const SMOKE_TIMEOUT: Duration = Duration::from_secs(90);
/// A smoke run that also imports media (Studio) gets longer: a 12K panorama on a
/// small CI runner takes tens of seconds.
const SMOKE_IMPORT_TIMEOUT: Duration = Duration::from_secs(600);

/// App-specific commands: their names (for routing) and the generated handler.
pub struct Commands<H> {
    pub names: &'static [&'static str],
    pub handler: H,
}

/// No app-specific commands (the Viewer, for now).
pub fn no_commands() -> Commands<fn(Invoke<Wry>) -> bool> {
    Commands { names: &[], handler: |_| false }
}

pub type SetupHook = Box<dyn FnOnce(&mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> + Send>;

pub fn run<H>(context: tauri::Context<Wry>, spec: AppSpec, commands: Commands<H>, setup: Option<SetupHook>)
where
    H: Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
{
    let args = launch::parse(std::env::args().skip(1));
    let smoke: Option<PathBuf> = args.smoke_test.clone();
    let timeout = if args.smoke_import.is_some() { SMOKE_IMPORT_TIMEOUT } else { SMOKE_TIMEOUT };
    let AppSpec { name, width, height } = spec;
    let shared = shared_handler();
    let Commands { names, handler } = commands;

    tauri::Builder::default()
        .manage(Launch { name, args })
        .invoke_handler(move |invoke: Invoke<Wry>| {
            if names.contains(&invoke.message.command()) {
                handler(invoke)
            } else {
                shared(invoke)
            }
        })
        .setup(move |app| {
            if let Some(hook) = setup {
                hook(app)?;
            }
            let allow_dev = cfg!(debug_assertions);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(name)
                .inner_size(width, height)
                .min_inner_size(960.0, 600.0)
                .on_navigation(move |url| net::is_app_url(url.as_str(), allow_dev))
                .initialization_script(HARDEN)
                .build()?;

            if let Some(path) = smoke {
                let handle = app.handle().clone();
                let version = app.package_info().version.to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(timeout);
                    let msg = format!("UI did not report within {} s", timeout.as_secs());
                    let _ = SmokeReport::failure(name, &version, msg)
                        .write(&path);
                    handle.exit(2);
                });
            }
            Ok(())
        })
        .run(context)
        .unwrap_or_else(|e| panic!("{name} failed to start: {e}"));
}
