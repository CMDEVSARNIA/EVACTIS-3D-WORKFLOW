//! Import one file into a project: validate, copy (hashing as it goes), derive previews,
//! tiles or a playback video, and record it. All work happens in a staging folder that
//! is renamed into place only when everything succeeded, so a crash, error or cancel
//! never leaves a half-built asset in the library.

use crate::error::{MediaError, Result};
use crate::exif::{self, CaptureInfo};
use crate::library::{self, AssetKind, AssetRecord, RECORD_VERSION};
use crate::model;
use crate::probe::{self, ImageLayout, Probe, RECOMMENDED_MIN_WIDTH};
use crate::tiles::{self, TileJob};
use crate::video::Ffmpeg;
use image::{imageops::FilterType, DynamicImage, ImageReader, Limits, RgbImage};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    Validating,
    Copying,
    Decoding,
    Previews,
    Tiling,
    Transcoding,
    Finishing,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Progress {
    pub stage: Stage,
    pub done: u64,
    pub total: u64,
}

/// What the file is for; decides how it is validated and processed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Purpose {
    /// A scene: panorama, 360 video, GLB or splat.
    #[default]
    Scene,
    FloorPlan,
}

#[derive(Debug, Clone)]
pub struct ImportOptions {
    pub purpose: Purpose,
    pub tile_size: u32,
    pub jpeg_quality: u8,
    pub preview_width: u32,
    pub thumb_width: u32,
    /// Playback videos wider than this are scaled down (decoder compatibility).
    pub video_max_width: u32,
    pub ffmpeg: Option<Ffmpeg>,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            purpose: Purpose::Scene,
            tile_size: 512,
            jpeg_quality: 88,
            preview_width: 2048,
            thumb_width: 512,
            video_max_width: 4096,
            ffmpeg: None,
        }
    }
}

/// HDR panoramas are decoded as 32-bit float; cap their size to keep memory sane.
const MAX_HDR_WIDTH: u32 = 16_384;
/// Plan images are scaled to fit this (sharp at full-screen zoom, small enough to load
/// fast on modest hardware).
pub const PLAN_MAX_SIDE: u32 = 4096;
/// Below this (longest side) a plan is too coarse to place scenes on precisely.
const PLAN_MIN_SIDE: u32 = 1000;

pub type ProgressFn<'a> = &'a (dyn Fn(Progress) + Sync);

pub fn import_file(
    project_root: &Path,
    src: &Path,
    opts: &ImportOptions,
    cancel: &AtomicBool,
    progress: ProgressFn,
) -> Result<AssetRecord> {
    let report = |stage, done, total| progress(Progress { stage, done, total });
    report(Stage::Validating, 0, 1);
    if !src.is_file() {
        return Err(MediaError::Invalid(format!(
            "{} is not a file",
            src.display()
        )));
    }
    let probed = match opts.purpose {
        Purpose::Scene => probe::probe(src)?,
        Purpose::FloorPlan => probe::probe_plan(src)?,
    };
    if let Probe::Panorama {
        hdr: true, width, ..
    } = probed
    {
        if width > MAX_HDR_WIDTH {
            return Err(MediaError::Invalid(format!(
                "HDR panoramas are limited to {MAX_HDR_WIDTH} px wide; this one is {width} px"
            )));
        }
    }
    let ffmpeg = match probed {
        Probe::Video => Some(opts.ffmpeg.clone().ok_or_else(|| {
            MediaError::Ffmpeg("video import needs the bundled ffmpeg, which was not found".into())
        })?),
        _ => None,
    };
    let video_info = match &ffmpeg {
        Some(f) => {
            let info = f.probe(src)?;
            info.layout()?;
            Some(info)
        }
        None => None,
    };

    let media = library::media_dir(project_root);
    fs::create_dir_all(&media)?;
    let staging = staging_dir(&media)?;
    let result = (|| {
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let source_name = format!("source.{ext}");
        let (sha, bytes) = copy_hashing(src, &staging.join(&source_name), cancel, &|d, t| {
            report(Stage::Copying, d, t)
        })?;
        let id = sha[..16].to_string();
        if library::exists(project_root, &id) {
            return Err(MediaError::Duplicate(id));
        }
        let file_name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut rec = AssetRecord {
            record_version: RECORD_VERSION,
            id: id.clone(),
            kind: AssetKind::Panorama,
            name: src
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            original_file_name: file_name,
            sha256: sha,
            bytes,
            imported_at: library::now_iso(),
            source: library::rel(&id, &source_name),
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
        let source = staging.join(&source_name);
        match &probed {
            Probe::Panorama {
                width,
                height,
                layout,
                hdr,
                ..
            } => {
                rec.kind = if *layout == ImageLayout::Mono {
                    AssetKind::Panorama
                } else {
                    AssetKind::PanoramaStereo
                };
                rec.width = Some(*width);
                rec.height = Some(*height);
                rec.layout = Some(*layout);
                rec.hdr = *hdr;
                rec.capture = exif::read(&source);
                if *width < RECOMMENDED_MIN_WIDTH {
                    rec.warnings.push(format!(
                        "low-resolution: {width} px wide; at least {RECOMMENDED_MIN_WIDTH} px is recommended"
                    ));
                }
                panorama(
                    &source, &staging, &id, *layout, opts, cancel, &report, &mut rec,
                )?;
            }
            Probe::Video => {
                let (f, info) = (
                    ffmpeg.as_ref().expect("checked"),
                    video_info.as_ref().expect("checked"),
                );
                rec.kind = AssetKind::Video360;
                rec.width = Some(info.width);
                rec.height = Some(info.height);
                rec.layout = Some(info.layout()?);
                rec.duration_sec = Some(info.duration_sec);
                rec.video_codec = Some(info.codec.clone());
                let total = (info.duration_sec * 1e6) as u64;
                report(Stage::Transcoding, 0, total);
                let file = f.transcode(
                    &source,
                    info,
                    &staging,
                    opts.video_max_width,
                    cancel,
                    &|d, t| report(Stage::Transcoding, d, t),
                )?;
                rec.playback = Some(library::rel(&id, &file));
                report(Stage::Previews, 0, 1);
                let poster = staging.join("poster-full.jpg");
                f.poster(&source, info, &poster)?;
                let frame = image::open(&poster)?.to_rgb8();
                fs::remove_file(&poster)?;
                let left = left_eye(&frame, rec.layout.unwrap_or(ImageLayout::Mono));
                write_previews(&left, &staging, &id, opts, &mut rec)?;
            }
            Probe::Glb => {
                rec.kind = AssetKind::Glb;
                model::check_glb(&source)?;
            }
            Probe::Splat { format } => {
                rec.kind = AssetKind::Splat;
                rec.points = model::check_splat(&source, format)?;
                rec.splat_format = Some(format.clone());
            }
            Probe::Plan { width, height } => {
                rec.kind = AssetKind::FloorPlan;
                if (*width).max(*height) < PLAN_MIN_SIDE {
                    rec.warnings.push(format!(
                        "low-resolution: {width}×{height} px; at least {PLAN_MIN_SIDE} px on the long side is recommended"
                    ));
                }
                plan(&source, &staging, &id, opts, &report, &mut rec)?;
            }
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(MediaError::Cancelled);
        }
        report(Stage::Finishing, 0, 1);
        library::write_record(&staging, &rec)?;
        let dest = library::asset_dir(project_root, &id);
        if dest.exists() {
            // A folder without a record: an earlier import that never finished.
            fs::remove_dir_all(&dest)?;
        }
        fs::rename(&staging, &dest)?;
        report(Stage::Finishing, 1, 1);
        Ok(rec)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn staging_dir(media: &Path) -> Result<PathBuf> {
    static N: AtomicU64 = AtomicU64::new(0);
    loop {
        let n = N.fetch_add(1, Ordering::Relaxed);
        let d = media.join(format!(".import-{}-{n}", std::process::id()));
        match fs::create_dir(&d) {
            Ok(()) => return Ok(d),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
}

/// Copies `src` to `dst` while hashing it; returns (hex SHA-256, bytes).
fn copy_hashing(
    src: &Path,
    dst: &Path,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<(String, u64)> {
    let total = fs::metadata(src)?.len();
    let mut input = fs::File::open(src)?;
    let mut output = fs::File::create(dst)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(MediaError::Cancelled);
        }
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        output.write_all(&buf[..n])?;
        done += n as u64;
        progress(done, total);
    }
    output.sync_all()?;
    let hex = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((hex, done))
}

fn decode(path: &Path) -> Result<DynamicImage> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = Limits::default();
    // 32K × 16K RGBA8 is 2 GiB; the default 512 MiB cap would reject large panoramas.
    limits.max_alloc = Some(3 << 30);
    reader.limits(limits);
    Ok(reader.decode()?)
}

/// Reinhard tone mapping with automatic exposure (log-average luminance), sRGB output.
pub fn tonemap(img: &image::Rgb32FImage) -> RgbImage {
    let lum = |p: &image::Rgb<f32>| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    let n = (img.width() as f64) * (img.height() as f64);
    let log_avg = (img
        .pixels()
        .map(|p| (1e-4 + lum(p) as f64).ln())
        .sum::<f64>()
        / n)
        .exp();
    let key = 0.18 / log_avg.max(1e-6);
    let srgb = |c: f64| {
        let c = c.clamp(0.0, 1.0);
        let v = if c <= 0.003_130_8 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        };
        (v * 255.0).round() as u8
    };
    RgbImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y);
        let l = lum(p) as f64 * key;
        let scale = if l > 0.0 {
            (l / (1.0 + l)) / l * key
        } else {
            0.0
        };
        image::Rgb([
            srgb(p[0] as f64 * scale),
            srgb(p[1] as f64 * scale),
            srgb(p[2] as f64 * scale),
        ])
    })
}

/// The left-eye half of a stereo frame (top for top-bottom, left for side-by-side).
fn left_eye(img: &RgbImage, layout: ImageLayout) -> RgbImage {
    let (w, h) = img.dimensions();
    match layout {
        ImageLayout::Mono => img.clone(),
        ImageLayout::StereoTopBottom => image::imageops::crop_imm(img, 0, 0, w, h / 2).to_image(),
        ImageLayout::StereoSideBySide => image::imageops::crop_imm(img, 0, 0, w / 2, h).to_image(),
    }
}

fn write_previews(
    img: &RgbImage,
    dir: &Path,
    id: &str,
    opts: &ImportOptions,
    rec: &mut AssetRecord,
) -> Result<()> {
    let pw = opts.preview_width.min(img.width());
    let preview = image::imageops::resize(img, pw, pw / 2, FilterType::Triangle);
    tiles::encode_jpeg(&preview, &dir.join("preview.jpg"), opts.jpeg_quality)?;
    let thumb = image::imageops::resize(
        &preview,
        opts.thumb_width,
        opts.thumb_width / 2,
        FilterType::Triangle,
    );
    tiles::encode_jpeg(&thumb, &dir.join("thumb.jpg"), opts.jpeg_quality)?;
    rec.preview = Some(library::rel(id, "preview.jpg"));
    rec.thumbnail = Some(library::rel(id, "thumb.jpg"));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn panorama(
    source: &Path,
    staging: &Path,
    id: &str,
    layout: ImageLayout,
    opts: &ImportOptions,
    cancel: &AtomicBool,
    report: &(dyn Fn(Stage, u64, u64) + Sync),
    rec: &mut AssetRecord,
) -> Result<()> {
    report(Stage::Decoding, 0, 1);
    let decoded = decode(source)?;
    let rgb = if rec.hdr {
        tonemap(&decoded.to_rgb32f())
    } else {
        decoded.to_rgb8()
    };
    drop(decoded);
    report(Stage::Decoding, 1, 1);
    if cancel.load(Ordering::Relaxed) {
        return Err(MediaError::Cancelled);
    }
    let eye = left_eye(&rgb, layout);
    report(Stage::Previews, 0, 1);
    write_previews(&eye, staging, id, opts, rec)?;
    report(Stage::Previews, 1, 1);
    // Stereo scenes render from the full source in VR (Phase 9); tiles are for mono.
    if layout == ImageLayout::Mono {
        let set = tiles::generate(&TileJob {
            image: &eye,
            out_dir: &staging.join("tiles"),
            base_path: library::rel(id, "tiles"),
            tile_size: opts.tile_size,
            quality: opts.jpeg_quality,
            cancel,
            progress: &|d, t| report(Stage::Tiling, d, t),
        })?;
        rec.tiles = Some(set);
    }
    Ok(())
}

/// Writes the plan image (PNG for PNG/TIFF sources, which are usually line art; JPEG for
/// photos and scans) and a thumbnail, both keeping the aspect ratio.
fn plan(
    source: &Path,
    staging: &Path,
    id: &str,
    opts: &ImportOptions,
    report: &(dyn Fn(Stage, u64, u64) + Sync),
    rec: &mut AssetRecord,
) -> Result<()> {
    report(Stage::Decoding, 0, 1);
    let img = decode(source)?.to_rgb8();
    report(Stage::Decoding, 1, 1);
    report(Stage::Previews, 0, 1);
    let fit = |img: &RgbImage, max: u32| {
        let (w, h) = img.dimensions();
        if w.max(h) <= max {
            return img.clone();
        }
        let s = max as f64 / w.max(h) as f64;
        let (nw, nh) = (
            ((w as f64 * s).round() as u32).max(1),
            ((h as f64 * s).round() as u32).max(1),
        );
        image::imageops::resize(img, nw, nh, FilterType::Lanczos3)
    };
    let plan = fit(&img, PLAN_MAX_SIDE);
    drop(img);
    let lossless = matches!(
        source
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("png" | "tif" | "tiff")
    );
    let name = if lossless {
        plan.save_with_format(staging.join("plan.png"), image::ImageFormat::Png)?;
        "plan.png"
    } else {
        tiles::encode_jpeg(&plan, &staging.join("plan.jpg"), opts.jpeg_quality.max(92))?;
        "plan.jpg"
    };
    let thumb = fit(&plan, opts.thumb_width);
    tiles::encode_jpeg(&thumb, &staging.join("thumb.jpg"), opts.jpeg_quality)?;
    rec.width = Some(plan.width());
    rec.height = Some(plan.height());
    rec.preview = Some(library::rel(id, name));
    rec.thumbnail = Some(library::rel(id, "thumb.jpg"));
    report(Stage::Previews, 1, 1);
    Ok(())
}
