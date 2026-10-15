//! Equirectangular → multi-resolution cube tiles in the Viewer's layout.

use crate::cube::{self, Basis};
use crate::error::{MediaError, Result};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, RgbImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::BufWriter,
    path::Path,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileSet {
    /// Relative to the project root, forward slashes.
    pub base_path: String,
    pub tile_size: u32,
    pub levels: Vec<Level>,
    pub format: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Level {
    pub size: u32,
}

/// Cube face sizes for an equirectangular image `width` px wide: 512, 1024, … up to the
/// face size that preserves the source resolution (width / π, rounded to whole tiles).
pub fn level_sizes(width: u32, tile_size: u32) -> Vec<u32> {
    let full = ((width as f64 / std::f64::consts::PI / tile_size as f64).round() as u32).max(1)
        * tile_size;
    let mut sizes = vec![];
    let mut s = tile_size;
    while s < full {
        sizes.push(s);
        s *= 2;
    }
    sizes.push(full);
    sizes
}

/// Samples an equirectangular image bilinearly, wrapping horizontally.
fn sample(img: &RgbImage, yaw: f64, pitch: f64) -> [u8; 3] {
    let (w, h) = (img.width() as f64, img.height() as f64);
    let x = (yaw + 180.0) / 360.0 * w - 0.5;
    let y = ((90.0 - pitch) / 180.0 * h - 0.5).clamp(0.0, h - 1.0);
    let x0 = x.floor();
    let y0 = y.floor();
    let (fx, fy) = (x - x0, y - y0);
    let wrap = |v: f64| {
        (((v as i64) % img.width() as i64 + img.width() as i64) % img.width() as i64) as u32
    };
    let (xa, xb) = (wrap(x0), wrap(x0 + 1.0));
    let (ya, yb) = (y0 as u32, (y0 as u32 + 1).min(img.height() - 1));
    let p = |x: u32, y: u32| img.get_pixel(x, y).0;
    let (a, b, c, d) = (p(xa, ya), p(xb, ya), p(xa, yb), p(xb, yb));
    let mut out = [0u8; 3];
    for i in 0..3 {
        let top = a[i] as f64 * (1.0 - fx) + b[i] as f64 * fx;
        let bot = c[i] as f64 * (1.0 - fx) + d[i] as f64 * fx;
        out[i] = (top * (1.0 - fy) + bot * fy).round() as u8;
    }
    out
}

pub fn encode_jpeg(img: &RgbImage, path: &Path, quality: u8) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut w = BufWriter::new(fs::File::create(path)?);
    JpegEncoder::new_with_quality(&mut w, quality).encode_image(img)?;
    Ok(())
}

/// Halving pyramid so each level samples a source of matching density (no aliasing).
fn pyramid(src: &RgbImage, smallest_face: u32) -> Vec<RgbImage> {
    let mut out: Vec<RgbImage> = vec![];
    let mut w = src.width() / 2;
    while w >= smallest_face * 4 {
        let prev = out.last().unwrap_or(src);
        out.push(image::imageops::resize(
            prev,
            w,
            w / 2,
            FilterType::Triangle,
        ));
        w /= 2;
    }
    out
}

pub struct TileJob<'a> {
    pub image: &'a RgbImage,
    /// Where tiles are written (`{out_dir}/{face}/{level}/{row}_{col}.jpg`).
    pub out_dir: &'a Path,
    /// Recorded in the tile set: the same folder relative to the project root.
    pub base_path: String,
    pub tile_size: u32,
    pub quality: u8,
    pub cancel: &'a AtomicBool,
    pub progress: &'a (dyn Fn(u64, u64) + Sync),
}

/// Generates every tile of every level. Tiles are independent and rendered in parallel.
pub fn generate(job: &TileJob) -> Result<TileSet> {
    let sizes = level_sizes(job.image.width(), job.tile_size);
    let pyr = pyramid(job.image, sizes[0]);
    let source_for = |face: u32| -> &RgbImage {
        // Smallest image still offering ≥ 1 source pixel per face pixel (width ≥ 4 × face).
        pyr.iter()
            .rev()
            .find(|p| p.width() >= face * 4)
            .unwrap_or(job.image)
    };
    struct Tile {
        level: usize,
        size: u32,
        face: &'static str,
        row: u32,
        col: u32,
    }
    let faces: Vec<&'static str> = cube::faces().iter().map(|s| s.as_str()).collect();
    let mut tiles = vec![];
    for (level, &size) in sizes.iter().enumerate() {
        let n = size.div_ceil(job.tile_size);
        for &face in &faces {
            for row in 0..n {
                for col in 0..n {
                    tiles.push(Tile {
                        level,
                        size,
                        face,
                        row,
                        col,
                    });
                }
            }
        }
    }
    let total = tiles.len() as u64;
    let done = AtomicU64::new(0);
    tiles.par_iter().try_for_each(|t| -> Result<()> {
        if job.cancel.load(Ordering::Relaxed) {
            return Err(MediaError::Cancelled);
        }
        let b: Basis = cube::basis(t.face);
        let src = source_for(t.size);
        let w = job.tile_size.min(t.size - t.col * job.tile_size);
        let h = job.tile_size.min(t.size - t.row * job.tile_size);
        let mut out = RgbImage::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let d = cube::face_pixel_direction(
                    &b,
                    t.size,
                    (t.col * job.tile_size + x) as f64,
                    (t.row * job.tile_size + y) as f64,
                );
                let (yaw, pitch) = cube::angles(d);
                out.put_pixel(x, y, image::Rgb(sample(src, yaw, pitch)));
            }
        }
        let rel = cube::tile_path(".", t.face, t.level, t.row, t.col, "jpg");
        encode_jpeg(&out, &job.out_dir.join(&rel[2..]), job.quality)?;
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        (job.progress)(n, total);
        Ok(())
    })?;
    Ok(TileSet {
        base_path: job.base_path.clone(),
        tile_size: job.tile_size,
        levels: sizes.into_iter().map(|size| Level { size }).collect(),
        format: "jpg".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_ladder_preserves_source_resolution() {
        // 12288 / π = 3911 px → 8 tiles of 512 = 4096 px faces at the top level.
        assert_eq!(level_sizes(12_288, 512), vec![512, 1024, 2048, 4096]);
        // 4096 / π = 1304 px → 3 tiles = 1536 px.
        assert_eq!(level_sizes(4_096, 512), vec![512, 1024, 1536]);
        assert_eq!(level_sizes(1_024, 512), vec![512]);
    }

    /// Analytic panorama: red encodes yaw, green encodes pitch. Every tile pixel must
    /// decode back to the direction the Viewer would draw it at.
    #[test]
    fn tiles_sample_the_direction_the_viewer_draws() {
        let (w, h) = (2048u32, 1024u32);
        let img = RgbImage::from_fn(w, h, |x, y| {
            let yaw = (x as f64 + 0.5) / w as f64 * 360.0 - 180.0;
            let pitch = 90.0 - (y as f64 + 0.5) / h as f64 * 180.0;
            image::Rgb([
                ((yaw + 180.0) / 360.0 * 255.0) as u8,
                ((pitch + 90.0) / 180.0 * 255.0) as u8,
                0,
            ])
        });
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let set = generate(&TileJob {
            image: &img,
            out_dir: dir.path(),
            base_path: "media/x/tiles".into(),
            tile_size: 256,
            quality: 100,
            cancel: &cancel,
            progress: &|_, _| {},
        })
        .unwrap();
        assert_eq!(
            set.levels.iter().map(|l| l.size).collect::<Vec<_>>(),
            vec![256, 512, 768]
        );
        let top = set.levels.len() - 1;
        for face in ["f", "r", "l", "u", "d"] {
            let tile = image::open(dir.path().join(format!("{face}/{top}/1_1.jpg")))
                .unwrap()
                .to_rgb8();
            let b = cube::basis(face);
            for (px, py) in [(40u32, 60u32), (200, 128), (128, 230)] {
                let (yaw, pitch) = cube::angles(cube::face_pixel_direction(
                    &b,
                    768,
                    (256 + px) as f64,
                    (256 + py) as f64,
                ));
                // Skip the yaw seam (±180°) where red wraps from 255 to 0.
                if yaw.abs() > 170.0 || pitch.abs() > 80.0 {
                    continue;
                }
                let p = tile.get_pixel(px, py).0;
                let got_yaw = p[0] as f64 / 255.0 * 360.0 - 180.0;
                let got_pitch = p[1] as f64 / 255.0 * 180.0 - 90.0;
                assert!(
                    (got_yaw - yaw).abs() < 4.0,
                    "{face} yaw {yaw} got {got_yaw}"
                );
                assert!(
                    (got_pitch - pitch).abs() < 3.0,
                    "{face} pitch {pitch} got {got_pitch}"
                );
            }
        }
        assert!(dir.path().join("b/0/0_0.jpg").exists());
    }

    #[test]
    fn cancelling_stops_tiling() {
        let img = RgbImage::new(1024, 512);
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(true);
        let job = TileJob {
            image: &img,
            out_dir: dir.path(),
            base_path: "t".into(),
            tile_size: 256,
            quality: 80,
            cancel: &cancel,
            progress: &|_, _| {},
        };
        assert!(matches!(generate(&job), Err(MediaError::Cancelled)));
    }
}
