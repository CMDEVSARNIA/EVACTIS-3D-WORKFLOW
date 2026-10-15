//! Capture metadata from EXIF (JPEG/TIFF): date, GPS position, camera.

use serde::{Deserialize, Serialize};
use std::{fs::File, io::BufReader, path::Path};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureInfo {
    /// ISO date (YYYY-MM-DD) from DateTimeOriginal / DateTime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps: Option<Gps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Gps {
    pub lat: f64,
    pub lon: f64,
}

fn rational_deg(v: &exif::Value) -> Option<f64> {
    if let exif::Value::Rational(r) = v {
        let p = |i: usize| r.get(i).map(|x| x.to_f64()).unwrap_or(0.0);
        if r.is_empty() {
            return None;
        }
        Some(p(0) + p(1) / 60.0 + p(2) / 3600.0)
    } else {
        None
    }
}

/// Reads capture info; files without EXIF (PNG, HDR, stitcher output) give defaults.
pub fn read(path: &Path) -> CaptureInfo {
    let Ok(file) = File::open(path) else {
        return CaptureInfo::default();
    };
    let Ok(data) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) else {
        return CaptureInfo::default();
    };
    let field = |t: exif::Tag| data.get_field(t, exif::In::PRIMARY);
    let text = |t: exif::Tag| {
        field(t).map(|f| {
            f.display_value()
                .to_string()
                .trim_matches('"')
                .trim()
                .to_string()
        })
    };

    let mut info = CaptureInfo::default();
    if let Some(dt) = text(exif::Tag::DateTimeOriginal).or_else(|| text(exif::Tag::DateTime)) {
        // EXIF: "2026:09:30 14:05:11" (display_value renders "2026-09-30 14:05:11").
        let norm = dt.replacen(':', "-", 2);
        let mut parts = norm.split(' ');
        let date = parts.next().unwrap_or("");
        if date.len() == 10 && date.as_bytes()[4] == b'-' {
            info.capture_date = Some(date.to_string());
            info.capture_time = parts.next().map(str::to_string);
        }
    }
    let lat = field(exif::Tag::GPSLatitude).and_then(|f| rational_deg(&f.value));
    let lon = field(exif::Tag::GPSLongitude).and_then(|f| rational_deg(&f.value));
    if let (Some(mut lat), Some(mut lon)) = (lat, lon) {
        if text(exif::Tag::GPSLatitudeRef).is_some_and(|r| r.starts_with('S')) {
            lat = -lat;
        }
        if text(exif::Tag::GPSLongitudeRef).is_some_and(|r| r.starts_with('W')) {
            lon = -lon;
        }
        if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) {
            info.gps = Some(Gps { lat, lon });
        }
    }
    let make = text(exif::Tag::Make).unwrap_or_default();
    let model = text(exif::Tag::Model).unwrap_or_default();
    let camera = if model.starts_with(&make) {
        model
    } else {
        format!("{make} {model}")
    };
    if !camera.trim().is_empty() {
        info.camera = Some(camera.trim().to_string());
    }
    info
}
