//! Tauri shell shared by Studio and Viewer.
//!
//! - creates the main window and refuses navigation to anything but bundled content
//! - exposes `app_info` (name, version, file to open) to the UI
//! - implements `--smoke-test <report.json>` for the Windows install smoke test

use std::{path::PathBuf, time::Duration};

use evx_core::{identity::PUBLISHER, launch, net, smoke::SmokeReport};
use serde::Serialize;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

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
) -> Result<(), String> {
    let Some(path) = launch.args.smoke_test.as_ref() else { return Ok(()) };
    let report = SmokeReport {
        app: launch.name.into(),
        version: app.package_info().version.to_string(),
        ui_ready: true,
        user_agent,
        location,
        blocked_requests,
        error: None,
    };
    report.write(path).map_err(|e| e.to_string())?;
    app.exit(if report.passed() { 0 } else { 1 });
    Ok(())
}

const SMOKE_TIMEOUT: Duration = Duration::from_secs(90);

pub fn run(context: tauri::Context<tauri::Wry>, spec: AppSpec) {
    let args = launch::parse(std::env::args().skip(1));
    let smoke: Option<PathBuf> = args.smoke_test.clone();
    let AppSpec { name, width, height } = spec;

    tauri::Builder::default()
        .manage(Launch { name, args })
        .invoke_handler(tauri::generate_handler![app_info, smoke_report])
        .setup(move |app| {
            let allow_dev = cfg!(debug_assertions);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(name)
                .inner_size(width, height)
                .min_inner_size(960.0, 600.0)
                .on_navigation(move |url| net::is_app_url(url.as_str(), allow_dev))
                .build()?;

            if let Some(path) = smoke {
                let handle = app.handle().clone();
                let version = app.package_info().version.to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(SMOKE_TIMEOUT);
                    let _ = SmokeReport::failure(name, &version, "UI did not report within 90 s")
                        .write(&path);
                    handle.exit(2);
                });
            }
            Ok(())
        })
        .run(context)
        .unwrap_or_else(|e| panic!("{name} failed to start: {e}"));
}
