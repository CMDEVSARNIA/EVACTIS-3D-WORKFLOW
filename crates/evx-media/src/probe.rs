//! Identifies and validates a file before anything is copied or decoded in full.

use crate::error::{MediaError, Result};
use image::ImageReader;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageLayout {
    /// 2:1 equirectangular.
    Mono,
    /// 1:1, left eye on top.
    StereoTopBottom,
    /// 4:1, left eye on the left.
    StereoSideBySide,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Probe {
    Panorama {
        width: u32,
        height: u32,
        layout: ImageLayout,
        hdr: bool,
        format: String,
    },
    Video,
    Glb,
    Splat {
        format: String,
    },
}

/// Largest panorama accepted (32K × 16K); beyond this decoding needs > 1.5 GB RAM.
pub const MAX_PANORAMA_WIDTH: u32 = 32_768;
/// Below this width a panorama looks soft on a 1080p screen; imported with a warning.
pub const RECOMMENDED_MIN_WIDTH: u32 = 6_000;

fn ext(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Ratio check with 1 % tolerance (stitchers often produce 8000×3999 and similar).
fn ratio_is(w: u32, h: u32, r: f64) -> bool {
    ((w as f64 / h as f64) / r - 1.0).abs() <= 0.01
}

/// Ratio check exposed for video frames, which use the same 2:1 / 1:1 / 4:1 rules.
pub fn layout_for(width: u32, height: u32) -> Option<ImageLayout> {
    if height == 0 {
        None
    } else if ratio_is(width, height, 2.0) {
        Some(ImageLayout::Mono)
    } else if ratio_is(width, height, 1.0) {
        Some(ImageLayout::StereoTopBottom)
    } else if ratio_is(width, height, 4.0) {
        Some(ImageLayout::StereoSideBySide)
    } else {
        None
    }
}

pub fn probe(path: &Path) -> Result<Probe> {
    let e = ext(path);
    match e.as_str() {
        "jpg" | "jpeg" | "png" | "tif" | "tiff" | "hdr" => probe_image(path, &e),
        "mp4" | "mov" | "m4v" | "mkv" | "webm" => Ok(Probe::Video),
        "glb" => Ok(Probe::Glb),
        "ply" | "splat" | "ksplat" | "spz" => Ok(Probe::Splat { format: e }),
        "" => Err(MediaError::Invalid("the file has no extension".into())),
        other => Err(MediaError::Invalid(format!(
            ".{other} files are not supported"
        ))),
    }
}

fn probe_image(path: &Path, e: &str) -> Result<Probe> {
    let reader = ImageReader::open(path)?.with_guessed_format()?;
    let format = reader
        .format()
        .ok_or_else(|| MediaError::Invalid("not a readable image".into()))?;
    let (width, height) = reader.into_dimensions()?;
    if width > MAX_PANORAMA_WIDTH {
        return Err(MediaError::Invalid(format!(
            "panorama is {width} px wide; the maximum is {MAX_PANORAMA_WIDTH} px"
        )));
    }
    let layout = layout_for(width, height).ok_or_else(|| {
        MediaError::Invalid(format!(
            "{width}×{height} is not a 360° panorama: expected 2:1 (or 1:1 / 4:1 for stereo)"
        ))
    })?;
    Ok(Probe::Panorama {
        width,
        height,
        layout,
        hdr: e == "hdr",
        format: format!("{format:?}").to_lowercase(),
    })
}
