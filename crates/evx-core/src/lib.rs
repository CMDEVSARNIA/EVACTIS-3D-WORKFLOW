//! Shared core for EVACTIS 3DWORKFLOW desktop apps. Deliberately free of Tauri and of
//! any networking crate so it builds and tests on every platform.

pub mod history;
pub mod identity;
pub mod launch;
pub mod net;
pub mod project;
pub mod smoke;
