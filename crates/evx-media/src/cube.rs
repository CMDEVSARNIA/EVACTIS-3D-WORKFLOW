//! Cube-face layout, read from the same JSON file as the Viewer
//! (`packages/viewer/src/panorama/cube-basis.json`) so tiles and renderer always agree.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

pub type Vec3 = [f64; 3];

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Basis {
    pub forward: Vec3,
    pub right: Vec3,
    pub up: Vec3,
}

#[derive(Deserialize)]
struct Layout {
    faces: Vec<String>,
    basis: HashMap<String, Basis>,
}

const LAYOUT_JSON: &str = include_str!("../../../packages/viewer/src/panorama/cube-basis.json");

fn layout() -> &'static (Vec<String>, HashMap<String, Basis>) {
    static L: OnceLock<(Vec<String>, HashMap<String, Basis>)> = OnceLock::new();
    L.get_or_init(|| {
        let l: Layout = serde_json::from_str(LAYOUT_JSON).expect("cube-basis.json is valid");
        (l.faces, l.basis)
    })
}

/// Face names in tile order: f, r, b, l, u, d.
pub fn faces() -> &'static [String] {
    &layout().0
}

pub fn basis(face: &str) -> Basis {
    layout().1[face]
}

/// Direction through the centre of pixel (px, py) of a face rendered at `size` px.
pub fn face_pixel_direction(b: &Basis, size: u32, px: f64, py: f64) -> Vec3 {
    let u = 2.0 * (px + 0.5) / size as f64 - 1.0;
    let v = 1.0 - 2.0 * (py + 0.5) / size as f64;
    [
        b.forward[0] + u * b.right[0] + v * b.up[0],
        b.forward[1] + u * b.right[1] + v * b.up[1],
        b.forward[2] + u * b.right[2] + v * b.up[2],
    ]
}

/// Yaw/pitch in degrees (yaw 0 = -Z, positive right; pitch positive up).
pub fn angles(d: Vec3) -> (f64, f64) {
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    let yaw = d[0].atan2(-d[2]).to_degrees();
    let pitch = (d[1] / len).clamp(-1.0, 1.0).asin().to_degrees();
    (yaw, pitch)
}

pub fn tile_path(base: &str, face: &str, level: usize, row: u32, col: u32, ext: &str) -> String {
    format!("{base}/{face}/{level}/{row}_{col}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_matches_viewer_expectations() {
        assert_eq!(faces(), ["f", "r", "b", "l", "u", "d"]);
        let expect = [
            ("f", 0.0, 0.0),
            ("r", 90.0, 0.0),
            ("b", 180.0, 0.0),
            ("l", -90.0, 0.0),
        ];
        for (face, yaw, pitch) in expect {
            let (y, p) = angles(basis(face).forward);
            assert!((y.abs() - f64::abs(yaw)).abs() < 1e-9, "{face}: {y}");
            assert!((p - pitch).abs() < 1e-9);
        }
        assert!((angles(basis("u").forward).1 - 90.0).abs() < 1e-9);
        assert!((angles(basis("d").forward).1 + 90.0).abs() < 1e-9);
    }
}
