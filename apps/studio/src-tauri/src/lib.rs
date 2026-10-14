pub fn run() {
    evx_desktop::run(
        tauri::generate_context!(),
        evx_desktop::AppSpec { name: "EVACTIS 3DWORKFLOW Studio", width: 1440.0, height: 900.0 },
    );
}
