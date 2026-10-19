//! The project media library: one folder per asset under `media/`, each described by
//! an `asset.json` record. The folder name is the asset ID (a content hash prefix), so
//! importing the same file twice is detected and paths never collide.
//!
//! ```text
//! <project>/media/<id>/source.<ext>    original file, byte for byte
//!                      preview.jpg     2048×1024 equirect (panoramas, video posters)
//!                      thumb.jpg       512×256 library thumbnail
//!                      tiles/…         multi-resolution cube tiles (mono panoramas)
//!                      video.mp4|webm  playback copy (360 video)
//!                      plan.png|jpg    plan image, ≤ 4096 px per side (floor plans)
//!                      asset.json      this record
//! ```

use crate::error::{MediaError, Result};
use crate::exif::CaptureInfo;
use crate::probe::ImageLayout;
use crate::tiles::TileSet;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MEDIA_DIR: &str = "media";
pub const RECORD_FILE: &str = "asset.json";
pub const RECORD_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    Panorama,
    PanoramaStereo,
    Video360,
    Glb,
    Splat,
    /// A floor plan. `preview` is the plan image scenes and calibration points refer to,
    /// and `width`/`height` are its size (the source may be larger).
    FloorPlan,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub record_version: u32,
    pub id: String,
    pub kind: AssetKind,
    /// Display name (the original file name without extension); editable later.
    pub name: String,
    pub original_file_name: String,
    pub sha256: String,
    pub bytes: u64,
    /// UTC, ISO 8601.
    pub imported_at: String,
    /// Paths below are relative to the project root, forward slashes.
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiles: Option<TileSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<ImageLayout>,
    #[serde(default)]
    pub hdr: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_codec: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub splat_format: Option<String>,
    /// Gaussian count for splats, when the format states it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<u64>,
    #[serde(default)]
    pub capture: CaptureInfo,
    /// Non-fatal findings shown in the library (e.g. low resolution).
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub fn media_dir(project_root: &Path) -> PathBuf {
    project_root.join(MEDIA_DIR)
}

pub fn asset_dir(project_root: &Path, id: &str) -> PathBuf {
    media_dir(project_root).join(id)
}

/// Project-relative path of a file inside an asset folder.
pub fn rel(id: &str, file: &str) -> String {
    format!("{MEDIA_DIR}/{id}/{file}")
}

pub fn exists(project_root: &Path, id: &str) -> bool {
    asset_dir(project_root, id).join(RECORD_FILE).is_file()
}

/// Writes `asset.json` atomically (temp file + rename) into `dir`.
pub fn write_record(dir: &Path, record: &AssetRecord) -> Result<()> {
    let json = serde_json::to_vec_pretty(record).map_err(|e| MediaError::Invalid(e.to_string()))?;
    let tmp = dir.join(".asset.json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, dir.join(RECORD_FILE))?;
    Ok(())
}

pub fn read_record(dir: &Path) -> Result<AssetRecord> {
    let bytes = fs::read(dir.join(RECORD_FILE))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| MediaError::Invalid(format!("{}: {e}", dir.display())))
}

pub struct Listing {
    pub assets: Vec<AssetRecord>,
    /// Folders under `media/` whose record is missing or unreadable.
    pub problems: Vec<String>,
}

/// Every asset in the project, oldest first. Staging folders (".import-…") are skipped.
pub fn list(project_root: &Path) -> Result<Listing> {
    let mut out = Listing {
        assets: vec![],
        problems: vec![],
    };
    let dir = media_dir(project_root);
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !entry.file_type()?.is_dir() {
            continue;
        }
        match read_record(&entry.path()) {
            Ok(r) => out.assets.push(r),
            Err(e) => out.problems.push(format!("{name}: {e}")),
        }
    }
    out.assets
        .sort_by(|a, b| a.imported_at.cmp(&b.imported_at).then(a.id.cmp(&b.id)));
    Ok(out)
}

/// Deletes an asset folder. The caller checks the environment no longer references it.
pub fn remove(project_root: &Path, id: &str) -> Result<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(MediaError::Invalid(format!("not an asset ID: {id}")));
    }
    fs::remove_dir_all(asset_dir(project_root, id))?;
    Ok(())
}

/// Removes staging folders left behind by an import that was killed mid-way.
pub fn clean_staging(project_root: &Path) -> Result<()> {
    let dir = media_dir(project_root);
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with(".import-") {
            fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}

/// Current UTC time as ISO 8601 (no date library needed).
pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso_from_unix(secs)
}

pub fn iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates() {
        assert_eq!(iso_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_from_unix(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso_from_unix(1_791_986_711), "2026-10-14T14:05:11Z");
    }

    #[test]
    fn lists_records_and_reports_broken_folders() {
        let root = tempfile::tempdir().unwrap();
        let rec = |id: &str, at: &str| AssetRecord {
            record_version: RECORD_VERSION,
            id: id.into(),
            kind: AssetKind::Glb,
            name: "Plant".into(),
            original_file_name: "Plant.glb".into(),
            sha256: id.repeat(4),
            bytes: 10,
            imported_at: at.into(),
            source: rel(id, "source.glb"),
            playback: None,
            preview: None,
            thumbnail: None,
            tiles: None,
            width: None,
            height: None,
            layout: None,
            hdr: false,
            duration_sec: None,
            video_codec: None,
            splat_format: None,
            points: None,
            capture: CaptureInfo::default(),
            warnings: vec![],
        };
        for (id, at) in [
            ("bb", "2026-10-14T10:00:00Z"),
            ("aa", "2026-10-13T10:00:00Z"),
        ] {
            let d = asset_dir(root.path(), id);
            fs::create_dir_all(&d).unwrap();
            write_record(&d, &rec(id, at)).unwrap();
        }
        fs::create_dir_all(asset_dir(root.path(), "cc")).unwrap();
        fs::create_dir_all(media_dir(root.path()).join(".import-1")).unwrap();

        let l = list(root.path()).unwrap();
        assert_eq!(
            l.assets.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["aa", "bb"]
        );
        assert_eq!(l.problems.len(), 1);
        assert!(exists(root.path(), "aa"));

        clean_staging(root.path()).unwrap();
        assert!(!media_dir(root.path()).join(".import-1").exists());
        assert!(remove(root.path(), "../x").is_err());
        remove(root.path(), "aa").unwrap();
        assert!(!exists(root.path(), "aa"));
    }
}
