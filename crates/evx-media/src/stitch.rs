//! Dual-fisheye stitching for 360° camera originals (Insta360 `.insp` photos): two
//! back-to-back circular fisheye images become one equirectangular panorama, which the
//! usual import pipeline then tiles. Photos only (Evactis, 2026-11-23); no network code.
//!
//! Each lens is described by where its circle sits on the sensor image, its field of
//! view, an equidistant projection with optional radial distortion terms, and where it
//! points. Every output pixel is looked up in the lens (or both, in the overlap) that
//! sees it; in the overlap the two are matched in exposure and feathered together.

use crate::cube::Vec3;
use image::RgbImage;
use rayon::prelude::*;

/// One fisheye lens of a 360° camera.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lens {
    /// Centre of the fisheye circle on the source image (pixels).
    pub cx: f64,
    pub cy: f64,
    /// Radius of the circle (pixels) at the edge of the field of view.
    pub radius: f64,
    /// Field of view across the circle, in degrees (typically 190 to 200).
    pub fov_deg: f64,
    /// Where the lens looks: yaw and pitch of its axis (degrees, panorama convention:
    /// yaw 0 = -Z, positive to the right; pitch positive up), and roll about that axis.
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    /// Radial distortion: angle θ (radians) is drawn at r ∝ θ (1 + k1 θ² + k2 θ⁴).
    pub k1: f64,
    pub k2: f64,
}

impl Lens {
    /// An ideal equidistant lens, for tests and as a starting point for calibration.
    pub fn equidistant(cx: f64, cy: f64, radius: f64, fov_deg: f64, yaw: f64) -> Self {
        Lens {
            cx,
            cy,
            radius,
            fov_deg,
            yaw,
            pitch: 0.0,
            roll: 0.0,
            k1: 0.0,
            k2: 0.0,
        }
    }

    fn half_fov(&self) -> f64 {
        self.fov_deg.to_radians() / 2.0
    }

    /// Radial distance (relative to the edge) at which angle θ is drawn.
    fn radial(&self, theta: f64) -> f64 {
        let t2 = theta * theta;
        let h = self.half_fov();
        let edge = h * (1.0 + self.k1 * h * h + self.k2 * h * h * h * h);
        theta * (1.0 + self.k1 * t2 + self.k2 * t2 * t2) / edge
    }

    /// The lens's axes (forward, right, up) in panorama space.
    fn frame(&self) -> (Vec3, Vec3, Vec3) {
        let (y, p, r) = (
            self.yaw.to_radians(),
            self.pitch.to_radians(),
            self.roll.to_radians(),
        );
        let f = dir(y, p);
        // Right and up before roll: right is horizontal, up completes the frame.
        let r0 = [y.cos(), 0.0, y.sin()];
        let u0 = cross(r0, f);
        let right = add(scale(r0, r.cos()), scale(u0, r.sin()));
        let up = add(scale(u0, r.cos()), scale(r0, -r.sin()));
        (f, right, up)
    }

    /// Where a panorama direction lands on the source image, and how far it is inside
    /// the field of view (radians; negative outside).
    fn project(&self, frame: &(Vec3, Vec3, Vec3), d: Vec3) -> (f64, f64, f64) {
        let (f, right, up) = frame;
        let z = dot(d, *f).clamp(-1.0, 1.0);
        let theta = z.acos();
        let phi = dot(d, *up).atan2(dot(d, *right));
        let r = self.radius * self.radial(theta);
        (
            self.cx + r * phi.cos(),
            self.cy - r * phi.sin(),
            self.half_fov() - theta,
        )
    }
}

/// Unit direction for yaw/pitch in radians (the inverse of `cube::angles`).
fn dir(yaw: f64, pitch: f64) -> Vec3 {
    [
        pitch.cos() * yaw.sin(),
        pitch.sin(),
        -pitch.cos() * yaw.cos(),
    ]
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn scale(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

/// Bilinear sample of the source image; None outside it.
fn sample(img: &RgbImage, x: f64, y: f64) -> Option<[f64; 3]> {
    let (x, y) = (x - 0.5, y - 0.5);
    if x < 0.0 || y < 0.0 || x > (img.width() - 1) as f64 || y > (img.height() - 1) as f64 {
        return None;
    }
    let (x0, y0) = (x.floor() as u32, y.floor() as u32);
    let (x1, y1) = (
        (x0 + 1).min(img.width() - 1),
        (y0 + 1).min(img.height() - 1),
    );
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let p = |x: u32, y: u32| img.get_pixel(x, y).0;
    let (a, b, c, d) = (p(x0, y0), p(x1, y0), p(x0, y1), p(x1, y1));
    let mut out = [0.0; 3];
    for i in 0..3 {
        let top = a[i] as f64 * (1.0 - fx) + b[i] as f64 * fx;
        let bot = c[i] as f64 * (1.0 - fx) + d[i] as f64 * fx;
        out[i] = top * (1.0 - fy) + bot * fy;
    }
    Some(out)
}

/// How the two lenses are joined.
#[derive(Debug, Clone, Copy)]
pub struct StitchOptions {
    /// Width of the panorama (height is half).
    pub width: u32,
    /// Width of the feathered seam, in degrees inside each lens's field of view.
    pub blend_deg: f64,
    /// Match the lenses' exposure from what both see in the overlap.
    pub match_exposure: bool,
}

/// The panorama width that keeps the source's detail: one panorama pixel per source
/// pixel at the centre of a lens, rounded to a multiple of 16.
pub fn natural_width(lens: &Lens) -> u32 {
    let px_per_rad = lens.radius / lens.half_fov();
    let w = (px_per_rad * std::f64::consts::TAU).round() as u32;
    (w / 16).max(1) * 16
}

/// Per-lens gains that make the overlap equally bright in both lenses (geometric mean
/// kept, so the overall exposure does not drift).
fn exposure_gains(src: &RgbImage, lenses: &[Lens; 2], blend: f64) -> [f64; 2] {
    let frames = [lenses[0].frame(), lenses[1].frame()];
    let (mut s0, mut s1, mut n) = (0.0, 0.0, 0u32);
    // A coarse grid over the sphere is plenty for an average.
    for py in 0..90 {
        for px in 0..180 {
            let yaw = (px as f64 + 0.5) / 180.0 * std::f64::consts::TAU - std::f64::consts::PI;
            let pitch =
                std::f64::consts::FRAC_PI_2 - (py as f64 + 0.5) / 90.0 * std::f64::consts::PI;
            let d = dir(yaw, pitch);
            let (x0, y0, m0) = lenses[0].project(&frames[0], d);
            let (x1, y1, m1) = lenses[1].project(&frames[1], d);
            if m0 <= 0.0 || m1 <= 0.0 || m0 > blend * 2.0 && m1 > blend * 2.0 {
                continue;
            }
            if let (Some(a), Some(b)) = (sample(src, x0, y0), sample(src, x1, y1)) {
                s0 += luma(a);
                s1 += luma(b);
                n += 1;
            }
        }
    }
    if n < 50 || s0 <= 0.0 || s1 <= 0.0 {
        return [1.0, 1.0];
    }
    let g = (s1 / s0).sqrt();
    [g, 1.0 / g]
}

fn luma(c: [f64; 3]) -> f64 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// Stitches a dual-fisheye image into an equirectangular panorama.
pub fn stitch(src: &RgbImage, lenses: &[Lens; 2], opts: &StitchOptions) -> RgbImage {
    let w = opts.width.max(16);
    let h = w / 2;
    let blend = opts.blend_deg.max(0.1).to_radians();
    let frames = [lenses[0].frame(), lenses[1].frame()];
    let gains = if opts.match_exposure {
        exposure_gains(src, lenses, blend)
    } else {
        [1.0, 1.0]
    };
    let mut out = RgbImage::new(w, h);
    out.par_chunks_mut(w as usize * 3)
        .enumerate()
        .for_each(|(row, line)| {
            let pitch =
                std::f64::consts::FRAC_PI_2 - (row as f64 + 0.5) / h as f64 * std::f64::consts::PI;
            for col in 0..w as usize {
                let yaw =
                    (col as f64 + 0.5) / w as f64 * std::f64::consts::TAU - std::f64::consts::PI;
                let d = dir(yaw, pitch);
                let (mut acc, mut total) = ([0.0; 3], 0.0);
                for i in 0..2 {
                    let (x, y, margin) = lenses[i].project(&frames[i], d);
                    if margin <= 0.0 {
                        continue;
                    }
                    let Some(c) = sample(src, x, y) else { continue };
                    // Feather: full weight inside, falling smoothly to 0 at the circle's edge.
                    let t = (margin / blend).min(1.0);
                    let wgt = t * t * (3.0 - 2.0 * t);
                    for k in 0..3 {
                        acc[k] += c[k] * gains[i] * wgt;
                    }
                    total += wgt;
                }
                if total > 0.0 {
                    for k in 0..3 {
                        line[col * 3 + k] = (acc[k] / total).round().clamp(0.0, 255.0) as u8;
                    }
                }
            }
        });
    out
}

/// Renders what a dual-fisheye camera would record of a panorama (tests and calibration
/// checks): each lens's circle drawn from the panorama, black outside.
pub fn render_fisheye(pano: &RgbImage, lenses: &[Lens; 2], width: u32, height: u32) -> RgbImage {
    let frames = [lenses[0].frame(), lenses[1].frame()];
    let mut out = RgbImage::new(width, height);
    for (x, y, px) in out.enumerate_pixels_mut() {
        for (i, l) in lenses.iter().enumerate() {
            let dx = x as f64 + 0.5 - l.cx;
            let dy = l.cy - (y as f64 + 0.5);
            let rr = (dx * dx + dy * dy).sqrt() / l.radius;
            if rr > 1.0 {
                continue;
            }
            // Invert the radial model by bisection (it rises monotonically).
            let (mut lo, mut hi) = (0.0, l.half_fov());
            for _ in 0..40 {
                let mid = (lo + hi) / 2.0;
                if l.radial(mid) < rr {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            let theta = (lo + hi) / 2.0;
            let phi = dy.atan2(dx);
            let (f, right, up) = frames[i];
            let d = add(
                scale(f, theta.cos()),
                add(
                    scale(right, theta.sin() * phi.cos()),
                    scale(up, theta.sin() * phi.sin()),
                ),
            );
            let (yaw, pitch) = crate::cube::angles(d);
            *px = image::Rgb(crate::tiles::sample(pano, yaw, pitch));
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A smooth, textured test panorama (no flat areas, no hard seams).
    fn panorama(w: u32) -> RgbImage {
        let h = w / 2;
        RgbImage::from_fn(w, h, |x, y| {
            let yaw = (x as f64 + 0.5) / w as f64 * std::f64::consts::TAU;
            let pitch = (y as f64 + 0.5) / h as f64 * std::f64::consts::PI;
            let r = 128.0 + 100.0 * (3.0 * yaw).sin() * pitch.sin();
            let g = 128.0 + 100.0 * (5.0 * pitch).cos();
            let b = 128.0 + 90.0 * (2.0 * yaw + 4.0 * pitch).sin();
            image::Rgb([r as u8, g as u8, b as u8])
        })
    }

    /// Back-to-back 200° lenses side by side, as dual-fisheye cameras record them.
    fn camera(size: u32) -> [Lens; 2] {
        let r = size as f64 / 2.0 - 4.0;
        let c = size as f64 / 2.0;
        [
            Lens::equidistant(c, c, r, 200.0, 0.0),
            Lens {
                roll: 0.0,
                ..Lens::equidistant(c + size as f64, c, r, 200.0, 180.0)
            },
        ]
    }

    fn psnr(a: &RgbImage, b: &RgbImage) -> f64 {
        let mse: f64 = a
            .as_raw()
            .iter()
            .zip(b.as_raw())
            .map(|(&x, &y)| (x as f64 - y as f64).powi(2))
            .sum::<f64>()
            / a.as_raw().len() as f64;
        10.0 * (255.0 * 255.0 / mse.max(1e-9)).log10()
    }

    #[test]
    fn directions_round_trip_with_the_panorama_convention() {
        for (yaw, pitch) in [(0.0, 0.0), (90.0, 10.0), (-135.0, -40.0), (179.0, 60.0)] {
            let (y, p) = crate::cube::angles(dir(f64::to_radians(yaw), f64::to_radians(pitch)));
            assert!(
                (y - yaw).abs() < 1e-9 && (p - pitch).abs() < 1e-9,
                "{yaw},{pitch}"
            );
        }
    }

    #[test]
    fn stitches_a_dual_fisheye_shot_back_into_its_panorama() {
        let pano = panorama(1024);
        let lenses = camera(512);
        let shot = render_fisheye(&pano, &lenses, 1024, 512);
        let opts = StitchOptions {
            width: 1024,
            blend_deg: 6.0,
            match_exposure: true,
        };
        let out = stitch(&shot, &lenses, &opts);
        assert_eq!((out.width(), out.height()), (1024, 512));
        let q = psnr(&out, &pano);
        assert!(q > 30.0, "PSNR {q:.1} dB");
    }

    #[test]
    fn matches_exposure_between_the_lenses() {
        let pano = panorama(1024);
        let lenses = camera(512);
        let mut shot = render_fisheye(&pano, &lenses, 1024, 512);
        // The rear lens recorded 25 % darker (a real camera exposes each lens on its own).
        for (x, _, p) in shot.enumerate_pixels_mut() {
            if x >= 512 {
                for c in p.0.iter_mut() {
                    *c = (*c as f64 * 0.75) as u8;
                }
            }
        }
        // Brightness of what each lens sees, relative to the true panorama: the front
        // (yaw 0, middle columns) and the back (yaw 180, edge columns), mid-height.
        let ratio = |img: &RgbImage, cols: std::ops::Range<u32>| -> f64 {
            let (mut got, mut want) = (0.0, 0.0);
            for y in 180..332 {
                for x in cols.clone() {
                    got += luma(img.get_pixel(x, y).0.map(f64::from));
                    want += luma(pano.get_pixel(x, y).0.map(f64::from));
                }
            }
            got / want
        };
        let imbalance = |img: &RgbImage| (ratio(img, 448..576) - ratio(img, 0..64)).abs();
        let plain = stitch(
            &shot,
            &lenses,
            &StitchOptions {
                width: 1024,
                blend_deg: 6.0,
                match_exposure: false,
            },
        );
        let matched = stitch(
            &shot,
            &lenses,
            &StitchOptions {
                width: 1024,
                blend_deg: 6.0,
                match_exposure: true,
            },
        );
        assert!(imbalance(&plain) > 0.2, "plain {:.3}", imbalance(&plain));
        assert!(
            imbalance(&matched) < 0.03,
            "matched {:.3}",
            imbalance(&matched)
        );
        assert!(psnr(&matched, &pano) > psnr(&plain, &pano));
    }

    #[test]
    fn distortion_and_roll_are_modelled_both_ways() {
        let pano = panorama(1024);
        let base = camera(512);
        let lenses = [
            Lens {
                k1: -0.03,
                roll: 2.0,
                pitch: 1.0,
                ..base[0]
            },
            Lens {
                k1: 0.02,
                k2: -0.004,
                roll: -1.5,
                ..base[1]
            },
        ];
        let shot = render_fisheye(&pano, &lenses, 1024, 512);
        let out = stitch(
            &shot,
            &lenses,
            &StitchOptions {
                width: 1024,
                blend_deg: 6.0,
                match_exposure: true,
            },
        );
        assert!(psnr(&out, &pano) > 30.0);
        // The wrong lens model (no distortion, no roll) is clearly worse: the model matters.
        let wrong = stitch(
            &shot,
            &base,
            &StitchOptions {
                width: 1024,
                blend_deg: 6.0,
                match_exposure: true,
            },
        );
        assert!(psnr(&wrong, &pano) < psnr(&out, &pano) - 3.0);
    }

    #[test]
    fn natural_width_keeps_the_lens_detail() {
        let l = Lens::equidistant(1000.0, 1000.0, 1000.0, 200.0, 0.0);
        // 1000 px over 100° → about 3600 px over 360°.
        assert_eq!(natural_width(&l), 3600);
    }
}

#[cfg(test)]
mod measure {
    use super::*;

    /// Quality and speed at a realistic size (X5: 72 MP, about 12K panoramas from two
    /// ~6K circles). Run: cargo test --release -p evx-media measure -- --ignored --nocapture
    #[test]
    #[ignore]
    fn quality_and_speed_at_x5_size() {
        let w = 11904u32;
        let pano = RgbImage::from_fn(w, w / 2, |x, y| {
            let yaw = (x as f64 + 0.5) / w as f64 * std::f64::consts::TAU;
            let pitch = (y as f64 + 0.5) / (w / 2) as f64 * std::f64::consts::PI;
            let v = 128.0 + 100.0 * (40.0 * yaw).sin() * (30.0 * pitch).cos();
            image::Rgb([v as u8, (255.0 - v) as u8, 128])
        });
        let size = 5952u32;
        let r = size as f64 / 2.0 - 8.0;
        let c = size as f64 / 2.0;
        let lenses = [
            Lens::equidistant(c, c, r, 200.0, 0.0),
            Lens::equidistant(c + size as f64, c, r, 200.0, 180.0),
        ];
        let shot = render_fisheye(&pano, &lenses, size * 2, size);
        let t = std::time::Instant::now();
        let out = stitch(
            &shot,
            &lenses,
            &StitchOptions {
                width: w,
                blend_deg: 5.0,
                match_exposure: true,
            },
        );
        let secs = t.elapsed().as_secs_f64();
        let mse: f64 = out
            .as_raw()
            .iter()
            .zip(pano.as_raw())
            .map(|(&a, &b)| (a as f64 - b as f64).powi(2))
            .sum::<f64>()
            / out.as_raw().len() as f64;
        println!(
            "{}x{} from 2 x {size}px circles in {secs:.2}s on {} threads; PSNR {:.1} dB",
            out.width(),
            out.height(),
            rayon::current_num_threads(),
            10.0 * (255.0f64 * 255.0 / mse).log10()
        );
    }
}
