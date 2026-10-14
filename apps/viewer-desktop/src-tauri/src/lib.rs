pub fn run() {
    evx_desktop::run(
        tauri::generate_context!(),
        evx_desktop::AppSpec { name: "EVACTIS 3DWORKFLOW Viewer", width: 1280.0, height: 800.0 },
    );
}
