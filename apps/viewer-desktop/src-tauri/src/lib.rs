mod package;

pub fn run() {
    use_bundled_webview2();
    evx_desktop::run(
        tauri::generate_context!(),
        evx_desktop::AppSpec { name: "EVACTIS 3DWORKFLOW Viewer", width: 1280.0, height: 800.0 },
        evx_desktop::Commands { names: package::COMMANDS, handler: package::handler() },
        Some(Box::new(|app| {
            package::manage(app.handle());
            Ok(())
        })),
    );
}

/// A portable folder may carry its own WebView2 (Fixed Version runtime) in `webview2\`
/// beside the executable, for computers without the system one.
fn use_bundled_webview2() {
    #[cfg(windows)]
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("webview2"))) {
        if dir.join("msedgewebview2.exe").is_file() {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", dir);
        }
    }
}
