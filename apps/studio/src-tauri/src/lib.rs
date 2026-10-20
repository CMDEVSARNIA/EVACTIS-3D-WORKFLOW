mod delivery;
mod studio;

use tauri::Manager;

pub fn run() {
    let smoke = evx_core::launch::parse(std::env::args().skip(1)).smoke_test.is_some();
    evx_desktop::run(
        tauri::generate_context!(),
        evx_desktop::AppSpec { name: "EVACTIS 3DWORKFLOW Studio", width: 1440.0, height: 900.0 },
        evx_desktop::Commands { names: studio::COMMANDS, handler: studio::handler() },
        Some(Box::new(move |app| {
            app.manage(studio::Studio::new(smoke));
            Ok(())
        })),
    );
}
