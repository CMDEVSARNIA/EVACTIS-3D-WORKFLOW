//! Imports a file into a project folder with the real pipeline and prints the asset
//! record as JSON. Used by the end-to-end test that renders Studio's tiles in the
//! Viewer, and handy for trying the pipeline by hand.
//!
//! ```text
//! cargo run -p evx-media --example import -- <file> <project-root>
//! cargo run -p evx-media --example import -- --compass <width> <project-root>
//! cargo run -p evx-media --example import -- --write-compass <width> <file.jpg>
//! cargo run -p evx-media --example import -- --write-room <width> <seed> <file.jpg>
//! cargo run -p evx-media --example import -- --write-plan <width> <height> <seed> <file.png>
//! cargo run -p evx-media --example import -- --plan <file> <project-root>
//! cargo run -p evx-media --example import -- --audio|--document|--photo <file> <project-root>
//! ```
//!
//! `--compass` first writes an equirectangular test panorama whose colour encodes the
//! direction: red ahead (yaw 0), green right, blue behind, yellow left, white above,
//! magenta below.
//!
//! `--write-room` paints a distinct test panorama per seed (the compass, with a seeded
//! band and numbered stripes), and `--write-plan` a simple floor plan with rooms: the
//! Studio end-to-end test builds a whole tour from these.

use evx_media::{import_file, ImportOptions, Purpose};
use image::{Rgb, RgbImage};
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

fn compass(width: u32) -> RgbImage {
    let height = width / 2;
    RgbImage::from_fn(width, height, |x, y| {
        let yaw = (x as f64 + 0.5) / width as f64 * 360.0 - 180.0;
        let pitch = 90.0 - (y as f64 + 0.5) / height as f64 * 180.0;
        let c = if pitch > 50.0 {
            [255, 255, 255]
        } else if pitch < -50.0 {
            [255, 0, 255]
        } else if (-45.0..45.0).contains(&yaw) {
            [230, 20, 20]
        } else if (45.0..135.0).contains(&yaw) {
            [20, 200, 20]
        } else if (-135.0..-45.0).contains(&yaw) {
            [240, 220, 0]
        } else {
            [20, 40, 230]
        };
        Rgb(c)
    })
}

/// The compass with a seed-coloured band at the horizon and `seed` dark stripes ahead,
/// so every seed gives a different file (and asset ID) and a recognisable picture.
fn room(width: u32, seed: u32) -> RgbImage {
    let mut img = compass(width);
    let (w, h) = img.dimensions();
    let band = [
        (seed * 67 % 200 + 40) as u8,
        (seed * 131 % 200 + 40) as u8,
        (seed * 29 % 200 + 40) as u8,
    ];
    for y in h * 9 / 20..h * 11 / 20 {
        for x in 0..w {
            img.put_pixel(x, y, Rgb(band));
        }
    }
    let stripe = (w / 160).max(2);
    for i in 0..seed.min(20) {
        let x0 = w / 2 - (seed.min(20) * stripe * 2) / 2 + i * stripe * 2;
        for y in h / 4..h * 2 / 5 {
            for x in x0..x0 + stripe {
                img.put_pixel(x, y, Rgb([20, 20, 20]));
            }
        }
    }
    img
}

/// A white plan with a navy outline and a grid of rooms; `seed` shifts the walls.
fn plan(width: u32, height: u32, seed: u32) -> RgbImage {
    let wall = Rgb([10, 47, 91]);
    let t = (width.max(height) / 200).max(2);
    let cols = 3 + seed % 3;
    RgbImage::from_fn(width, height, |x, y| {
        let border = x < t * 2 || y < t * 2 || x >= width - t * 2 || y >= height - t * 2;
        let vwall =
            (1..cols).any(|c| x.abs_diff(width * c / cols) < t) && (y % (height / 3)) > height / 12;
        let hwall = y.abs_diff(height / 2) < t && (x % (width / cols)) > width / (cols * 4);
        if border || vwall || hwall {
            wall
        } else {
            Rgb([250, 250, 250])
        }
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (src, root) = match args.as_slice() {
        [flag, width, root] if flag == "--compass" => {
            let root = PathBuf::from(root);
            std::fs::create_dir_all(&root).expect("create project folder");
            let src = root.join("compass.png");
            compass(width.parse().expect("width"))
                .save(&src)
                .expect("write compass");
            (src, root)
        }
        // Only write the test panorama (used by the Linux real-app smoke test).
        [flag, width, file] if flag == "--write-compass" => {
            compass(width.parse().expect("width"))
                .save(file)
                .expect("write compass");
            return;
        }
        [flag, width, seed, file] if flag == "--write-room" => {
            room(width.parse().expect("width"), seed.parse().expect("seed"))
                .save(file)
                .expect("write room");
            return;
        }
        [flag, width, height, seed, file] if flag == "--write-plan" => {
            plan(
                width.parse().expect("width"),
                height.parse().expect("height"),
                seed.parse().expect("seed"),
            )
            .save(file)
            .expect("write plan");
            return;
        }
        [flag, file, root] if flag == "--audio" || flag == "--document" || flag == "--photo" => {
            let purpose = match flag.as_str() {
                "--audio" => Purpose::Audio,
                "--document" => Purpose::Document,
                _ => Purpose::Photo,
            };
            let opts = ImportOptions {
                purpose,
                ..ImportOptions::default()
            };
            run(Path::new(file), Path::new(root), &opts);
            return;
        }
        [flag, file, root] if flag == "--plan" => {
            let opts = ImportOptions {
                purpose: Purpose::FloorPlan,
                ..ImportOptions::default()
            };
            run(Path::new(file), Path::new(root), &opts);
            return;
        }
        [file, root] => (PathBuf::from(file), PathBuf::from(root)),
        _ => {
            eprintln!(
                "usage: import <file> <project-root> | --compass <width> <project-root> | --plan|--audio|--document|--photo <file> <project-root>"
            );
            std::process::exit(2);
        }
    };
    run(&src, &root, &ImportOptions::default());
}

fn run(src: &Path, root: &Path, opts: &ImportOptions) {
    let cancel = AtomicBool::new(false);
    match import_file(root, src, opts, &cancel, &|_| {}) {
        Ok(record) => println!("{}", serde_json::to_string_pretty(&record).expect("json")),
        Err(e) => {
            eprintln!("import failed ({}): {e}", e.code());
            std::process::exit(1);
        }
    }
}
