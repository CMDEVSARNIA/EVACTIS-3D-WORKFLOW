//! Imports a file into a project folder with the real pipeline and prints the asset
//! record as JSON. Used by the end-to-end test that renders Studio's tiles in the
//! Viewer, and handy for trying the pipeline by hand.
//!
//! ```text
//! cargo run -p evx-media --example import -- <file> <project-root>
//! cargo run -p evx-media --example import -- --compass <width> <project-root>
//! ```
//!
//! `--compass` first writes an equirectangular test panorama whose colour encodes the
//! direction: red ahead (yaw 0), green right, blue behind, yellow left, white above,
//! magenta below.

use evx_media::{import_file, ImportOptions};
use image::{Rgb, RgbImage};
use std::{path::PathBuf, sync::atomic::AtomicBool};

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

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (src, root) = match args.as_slice() {
        [flag, width, root] if flag == "--compass" => {
            let root = PathBuf::from(root);
            std::fs::create_dir_all(&root).expect("create project folder");
            let src = root.join("compass.png");
            compass(width.parse().expect("width")).save(&src).expect("write compass");
            (src, root)
        }
        [file, root] => (PathBuf::from(file), PathBuf::from(root)),
        _ => {
            eprintln!("usage: import <file> <project-root> | import --compass <width> <project-root>");
            std::process::exit(2);
        }
    };
    let cancel = AtomicBool::new(false);
    match import_file(&root, &src, &ImportOptions::default(), &cancel, &|_| {}) {
        Ok(record) => println!("{}", serde_json::to_string_pretty(&record).expect("json")),
        Err(e) => {
            eprintln!("import failed ({}): {e}", e.code());
            std::process::exit(1);
        }
    }
}
