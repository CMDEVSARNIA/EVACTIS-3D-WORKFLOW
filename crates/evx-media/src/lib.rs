//! Local media pipeline for EVACTIS 3DWORKFLOW Studio.
//!
//! Everything here runs on the author's machine: files are validated, copied into the
//! project, tiled and transcoded locally. There is no network code in this crate.

pub mod cube;
pub mod error;
pub mod exif;
pub mod import;
pub mod library;
pub mod model;
pub mod probe;
pub mod tiles;
pub mod video;

pub use error::MediaError;
pub use import::{import_file, ImportOptions, Progress, Purpose, Stage};
pub use library::{AssetKind, AssetRecord};
