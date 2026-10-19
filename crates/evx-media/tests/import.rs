use evx_media::{
    import_file,
    library::{self, AssetKind},
    probe::ImageLayout,
    video::Ffmpeg,
    ImportOptions, MediaError, Progress, Purpose, Stage,
};
use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Mutex},
};

/// Minimal little-endian TIFF/EXIF block: Make, Model, DateTimeOriginal and GPS.
fn exif_block() -> Vec<u8> {
    // (tag, type, count, payload). Types: 2 ASCII, 4 LONG, 5 RATIONAL.
    type Entry = (u16, u16, u32, Vec<u8>);
    let ascii = |s: &str| {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    };
    let rationals = |vals: &[(u32, u32)]| {
        vals.iter()
            .flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat())
            .collect::<Vec<u8>>()
    };
    fn ifd(entries: &[Entry], start: u32) -> Vec<u8> {
        let mut head = (entries.len() as u16).to_le_bytes().to_vec();
        let mut data = vec![];
        let data_start = start + 2 + 12 * entries.len() as u32 + 4;
        for (tag, ty, count, payload) in entries {
            head.extend(tag.to_le_bytes());
            head.extend(ty.to_le_bytes());
            head.extend(count.to_le_bytes());
            if payload.len() <= 4 {
                let mut p = payload.clone();
                p.resize(4, 0);
                head.extend(p);
            } else {
                head.extend((data_start + data.len() as u32).to_le_bytes());
                data.extend(payload);
                if data.len() % 2 == 1 {
                    data.push(0);
                }
            }
        }
        head.extend(0u32.to_le_bytes());
        head.extend(data);
        head
    }
    let make = ascii("Insta360");
    let model = ascii("Insta360 X4");
    let date = ascii("2026:09:30 14:05:11");
    let gps: Vec<Entry> = vec![
        (1, 2, 2, ascii("S")),
        (2, 5, 3, rationals(&[(33, 1), (51, 1), (5400, 100)])),
        (3, 2, 2, ascii("W")),
        (4, 5, 3, rationals(&[(70, 1), (30, 1), (0, 1)])),
    ];
    // Lay out: header (8) | IFD0 | Exif IFD | GPS IFD.
    let ifd0_len = |exif_at: u32, gps_at: u32| {
        ifd(
            &[
                (0x010F, 2, make.len() as u32, make.clone()),
                (0x0110, 2, model.len() as u32, model.clone()),
                (0x8769, 4, 1, exif_at.to_le_bytes().to_vec()),
                (0x8825, 4, 1, gps_at.to_le_bytes().to_vec()),
            ],
            8,
        )
    };
    let len0 = ifd0_len(0, 0).len() as u32;
    let exif_at = 8 + len0;
    let exif_ifd = ifd(&[(0x9003, 2, date.len() as u32, date.clone())], exif_at);
    let gps_at = exif_at + exif_ifd.len() as u32;
    let mut out = b"II*\0".to_vec();
    out.extend(8u32.to_le_bytes());
    out.extend(ifd0_len(exif_at, gps_at));
    out.extend(exif_ifd);
    out.extend(ifd(&gps, gps_at));
    out
}

fn panorama(w: u32, h: u32) -> RgbImage {
    RgbImage::from_fn(w, h, |x, y| {
        Rgb([(x * 255 / w) as u8, (y * 255 / h) as u8, 90])
    })
}

fn write_jpeg_with_exif(img: &RgbImage, path: &Path) {
    let mut jpeg = vec![];
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(img)
        .unwrap();
    let tiff = exif_block();
    let mut app1 = vec![0xFF, 0xE1];
    app1.extend(((tiff.len() + 8) as u16).to_be_bytes());
    app1.extend(b"Exif\0\0");
    app1.extend(tiff);
    let mut out = jpeg[..2].to_vec();
    out.extend(app1);
    out.extend(&jpeg[2..]);
    std::fs::write(path, out).unwrap();
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    inbox: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("Plant A");
    let inbox = dir.path().join("inbox");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&inbox).unwrap();
    Fixture {
        _dir: dir,
        root,
        inbox,
    }
}

fn run(
    f: &Fixture,
    src: &Path,
    opts: &ImportOptions,
) -> (
    evx_media::error::Result<evx_media::AssetRecord>,
    Vec<Progress>,
) {
    let seen = Mutex::new(vec![]);
    let cancel = AtomicBool::new(false);
    let r = import_file(&f.root, src, opts, &cancel, &|p| {
        seen.lock().unwrap().push(p)
    });
    (r, seen.into_inner().unwrap())
}

fn media_entries(root: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(root.join("media"))
        .map(|d| {
            d.map(|e| e.unwrap().file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

#[test]
fn imports_a_panorama_with_tiles_previews_and_exif() {
    let f = fixture();
    let src = f.inbox.join("Lobby east.jpg");
    write_jpeg_with_exif(&panorama(4096, 2048), &src);
    let (r, progress) = run(&f, &src, &ImportOptions::default());
    let rec = r.unwrap();

    assert_eq!(rec.kind, AssetKind::Panorama);
    assert_eq!(rec.name, "Lobby east");
    assert_eq!(rec.id.len(), 16);
    assert_eq!(
        (rec.width, rec.height, rec.layout),
        (Some(4096), Some(2048), Some(ImageLayout::Mono))
    );
    assert_eq!(rec.capture.capture_date.as_deref(), Some("2026-09-30"));
    assert_eq!(rec.capture.camera.as_deref(), Some("Insta360 X4"));
    let gps = rec.capture.gps.unwrap();
    assert!(
        (gps.lat + 33.865).abs() < 1e-6 && (gps.lon + 70.5).abs() < 1e-6,
        "{gps:?}"
    );
    assert!(rec.warnings.iter().any(|w| w.starts_with("low-resolution")));

    let tiles = rec.tiles.as_ref().unwrap();
    assert_eq!(tiles.base_path, format!("media/{}/tiles", rec.id));
    assert_eq!(
        tiles.levels.iter().map(|l| l.size).collect::<Vec<_>>(),
        [512, 1024, 1536]
    );
    for face in ["f", "r", "b", "l", "u", "d"] {
        assert!(f
            .root
            .join(&tiles.base_path)
            .join(format!("{face}/2/2_2.jpg"))
            .is_file());
    }
    assert_eq!(
        image::image_dimensions(f.root.join(rec.preview.as_ref().unwrap())).unwrap(),
        (2048, 1024)
    );
    assert_eq!(
        image::image_dimensions(f.root.join(rec.thumbnail.as_ref().unwrap())).unwrap(),
        (512, 256)
    );
    assert_eq!(
        std::fs::read(f.root.join(&rec.source)).unwrap(),
        std::fs::read(&src).unwrap()
    );

    // Progress walks through the stages and the tiling count reaches its total.
    let stages: Vec<Stage> = progress.iter().map(|p| p.stage).collect();
    for s in [
        Stage::Validating,
        Stage::Copying,
        Stage::Decoding,
        Stage::Previews,
        Stage::Tiling,
        Stage::Finishing,
    ] {
        assert!(stages.contains(&s), "{s:?}");
    }
    let last_tile = progress.iter().rfind(|p| p.stage == Stage::Tiling).unwrap();
    assert_eq!(last_tile.done, last_tile.total);
    assert_eq!(last_tile.total, 6 * (1 + 4 + 9));

    // Listed, re-import refused, no staging left behind.
    let listing = library::list(&f.root).unwrap();
    assert_eq!(listing.assets, vec![rec.clone()]);
    let (again, _) = run(&f, &src, &ImportOptions::default());
    assert!(matches!(again, Err(MediaError::Duplicate(id)) if id == rec.id));
    assert_eq!(media_entries(&f.root), vec![rec.id.clone()]);
}

#[test]
fn rejects_non_panoramas_and_leaves_nothing_behind() {
    let f = fixture();
    let src = f.inbox.join("photo.png");
    panorama(1600, 1200).save(&src).unwrap();
    let (r, _) = run(&f, &src, &ImportOptions::default());
    let err = r.unwrap_err();
    assert_eq!(err.code(), "invalid");
    assert!(err.to_string().contains("not a 360° panorama"), "{err}");

    let txt = f.inbox.join("notes.txt");
    std::fs::write(&txt, "hello").unwrap();
    assert_eq!(
        run(&f, &txt, &ImportOptions::default())
            .0
            .unwrap_err()
            .code(),
        "invalid"
    );

    let fake = f.inbox.join("fake.jpg");
    std::fs::write(&fake, "not really a jpeg").unwrap();
    assert!(run(&f, &fake, &ImportOptions::default()).0.is_err());
    assert!(media_entries(&f.root).is_empty());
}

#[test]
fn insta360_originals_explain_the_export_step() {
    let f = fixture();
    for name in [
        "IMG_20261015_101500_00_001.insp",
        "VID_20261015_101600_00_002.insv",
    ] {
        let src = f.inbox.join(name);
        std::fs::write(&src, b"\xFF\xD8 not a stitched panorama").unwrap();
        let err = run(&f, &src, &ImportOptions::default()).0.unwrap_err();
        assert_eq!(err.code(), "unstitched", "{name}");
        assert!(err.to_string().contains("Insta360 Studio"), "{err}");
    }
    assert!(media_entries(&f.root).is_empty());
}

#[test]
fn stereo_panoramas_get_left_eye_previews_and_no_tiles() {
    let f = fixture();
    let src = f.inbox.join("stairs-3d.png");
    let mut img = panorama(1024, 1024);
    for y in 512..1024 {
        for x in 0..1024 {
            img.put_pixel(x, y, Rgb([255, 0, 255]));
        }
    }
    img.save(&src).unwrap();
    let rec = run(&f, &src, &ImportOptions::default()).0.unwrap();
    assert_eq!(rec.kind, AssetKind::PanoramaStereo);
    assert_eq!(rec.layout, Some(ImageLayout::StereoTopBottom));
    assert!(rec.tiles.is_none());
    let preview = image::open(f.root.join(rec.preview.unwrap()))
        .unwrap()
        .to_rgb8();
    assert_eq!(preview.dimensions(), (1024, 512));
    let p = preview.get_pixel(512, 500).0;
    assert!(
        p[0] < 200 && p[2] < 150,
        "preview must come from the top (left-eye) half: {p:?}"
    );
}

#[test]
fn hdr_panoramas_are_tone_mapped() {
    let f = fixture();
    let src = f.inbox.join("plant-room.hdr");
    let hdr = image::Rgb32FImage::from_fn(1024, 512, |x, _| {
        let v = if x < 512 { 0.05 } else { 40.0 };
        Rgb([v, v, v])
    });
    image::DynamicImage::ImageRgb32F(hdr).save(&src).unwrap();
    let rec = run(&f, &src, &ImportOptions::default()).0.unwrap();
    assert!(rec.hdr);
    assert!(rec.tiles.is_some());
    let preview = image::open(f.root.join(rec.preview.unwrap()))
        .unwrap()
        .to_rgb8();
    let (dark, bright) = (
        preview.get_pixel(100, 256).0[0],
        preview.get_pixel(900, 256).0[0],
    );
    assert!(
        dark < bright && bright < 255 && dark > 0,
        "dark {dark} bright {bright}"
    );
    // The luminance map for adaptive exposure: the bright half many stops above the
    // dark half, both around the log average (128 = 0 stops).
    let lum = image::open(f.root.join(rec.luminance.expect("luminance map")))
        .unwrap()
        .to_luma8();
    assert_eq!(lum.dimensions(), (128, 64));
    let (d, b) = (lum.get_pixel(10, 32).0[0], lum.get_pixel(120, 32).0[0]);
    assert!(d < 128 && b > 128, "dark {d} bright {b}");
    // 40 / 0.05 = 800× = 9.6 stops apart (16 stops span 255 levels).
    assert!(((b as f64 - d as f64) / 255.0 * 16.0 - 9.64).abs() < 0.2);
}

#[test]
fn cancelled_imports_leave_nothing_behind() {
    let f = fixture();
    let src = f.inbox.join("x.jpg");
    panorama(2048, 1024).save(&src).unwrap();
    let cancel = AtomicBool::new(true);
    let r = import_file(&f.root, &src, &ImportOptions::default(), &cancel, &|_| {});
    assert!(matches!(r, Err(MediaError::Cancelled)));
    assert!(media_entries(&f.root).is_empty());
}

#[test]
fn imports_glb_and_rejects_broken_ones() {
    let f = fixture();
    let json = br#"{"asset":{"version":"2.0"}}    "#;
    let mut glb = b"glTF".to_vec();
    glb.extend(2u32.to_le_bytes());
    glb.extend((20 + json.len() as u32).to_le_bytes());
    glb.extend((json.len() as u32).to_le_bytes());
    glb.extend(0x4E4F_534Au32.to_le_bytes());
    glb.extend(json);
    let ok = f.inbox.join("pump.glb");
    std::fs::write(&ok, &glb).unwrap();
    assert_eq!(
        run(&f, &ok, &ImportOptions::default()).0.unwrap().kind,
        AssetKind::Glb
    );
    let bad = f.inbox.join("cut.glb");
    std::fs::write(&bad, &glb[..30]).unwrap();
    assert!(run(&f, &bad, &ImportOptions::default()).0.is_err());
    assert_eq!(media_entries(&f.root).len(), 1);
}

#[test]
fn video_without_ffmpeg_is_a_clear_error() {
    let f = fixture();
    let src = f.inbox.join("walk.mp4");
    std::fs::write(&src, b"....").unwrap();
    let err = run(&f, &src, &ImportOptions::default()).0.unwrap_err();
    assert_eq!(err.code(), "ffmpeg");
}

/// Uses whatever ffmpeg is installed (EVX_FFMPEG_DIR or PATH); skipped when none is.
#[test]
fn imports_360_video_when_ffmpeg_is_available() {
    let Some(ff) = Ffmpeg::locate(None) else {
        eprintln!("ffmpeg not found; skipping");
        return;
    };
    let f = fixture();
    let src = f.inbox.join("walk.mkv");
    let st = std::process::Command::new(&ff.ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=512x256:rate=10:duration=2",
        ])
        .args(["-c:v", "mpeg4"])
        .arg(&src)
        .status()
        .unwrap();
    assert!(st.success());
    let opts = ImportOptions {
        ffmpeg: Some(ff),
        ..Default::default()
    };
    let (r, progress) = run(&f, &src, &opts);
    let rec = r.unwrap();
    assert_eq!(rec.kind, AssetKind::Video360);
    assert_eq!(rec.video_codec.as_deref(), Some("mpeg4"));
    assert!((rec.duration_sec.unwrap() - 2.0).abs() < 0.2);
    let playback = f.root.join(rec.playback.as_ref().unwrap());
    assert!(playback.is_file(), "{playback:?}");
    assert_eq!(
        image::image_dimensions(f.root.join(rec.preview.unwrap())).unwrap(),
        (512, 256)
    );
    let t = progress
        .iter()
        .rfind(|p| p.stage == Stage::Transcoding)
        .unwrap();
    assert_eq!(t.done, t.total);

    let wrong = f.inbox.join("phone.mkv");
    std::process::Command::new(f_ffmpeg(&opts))
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:duration=1",
            "-c:v",
            "mpeg4",
        ])
        .arg(&wrong)
        .status()
        .unwrap();
    assert!(run(&f, &wrong, &opts)
        .0
        .unwrap_err()
        .to_string()
        .contains("not a 360° video"));
}

fn f_ffmpeg(opts: &ImportOptions) -> PathBuf {
    opts.ffmpeg.as_ref().unwrap().ffmpeg.clone()
}

/// The Phase 3 acceptance size: a 12K (12288 × 6144) panorama. Run with
/// `cargo test -p evx-media --release -- --ignored`.
#[test]
#[ignore]
fn imports_a_12k_panorama() {
    let f = fixture();
    let src = f.inbox.join("12k.jpg");
    write_jpeg_with_exif(&panorama(12_288, 6_144), &src);
    let t = std::time::Instant::now();
    let rec = run(&f, &src, &ImportOptions::default()).0.unwrap();
    eprintln!("12K import: {:?}", t.elapsed());
    let sizes: Vec<u32> = rec.tiles.unwrap().levels.iter().map(|l| l.size).collect();
    assert_eq!(sizes, [512, 1024, 2048, 4096]);
    assert!(rec.warnings.is_empty());
}

#[test]
fn imports_floor_plans_scaled_with_their_aspect_ratio() {
    let f = fixture();
    let plan_opts = ImportOptions {
        purpose: Purpose::FloorPlan,
        ..ImportOptions::default()
    };
    // Line art (PNG) larger than the plan limit: kept lossless, scaled to fit.
    let src = f.inbox.join("Level 1.png");
    RgbImage::from_fn(6000, 3000, |x, y| {
        if x % 300 < 4 || y % 300 < 4 {
            Rgb([10, 47, 91])
        } else {
            Rgb([250, 250, 250])
        }
    })
    .save(&src)
    .unwrap();
    let rec = run(&f, &src, &plan_opts).0.unwrap();
    assert_eq!(rec.kind, AssetKind::FloorPlan);
    assert_eq!((rec.width, rec.height), (Some(4096), Some(2048)));
    let plan = rec.preview.clone().unwrap();
    assert!(plan.ends_with("/plan.png"), "{plan}");
    assert_eq!(
        image::image_dimensions(f.root.join(&plan)).unwrap(),
        (4096, 2048)
    );
    let thumb = image::image_dimensions(f.root.join(rec.thumbnail.as_ref().unwrap())).unwrap();
    assert_eq!(thumb, (512, 256));
    assert!(rec.warnings.is_empty());
    assert!(rec.tiles.is_none());
    assert_eq!(library::list(&f.root).unwrap().assets.len(), 1);

    // A small scanned plan (JPEG, portrait): kept at its size, with a warning.
    let scan = f.inbox.join("Basement scan.jpg");
    RgbImage::from_pixel(600, 900, Rgb([200, 200, 200]))
        .save(&scan)
        .unwrap();
    let rec = run(&f, &scan, &plan_opts).0.unwrap();
    assert_eq!((rec.width, rec.height), (Some(600), Some(900)));
    assert!(rec.preview.unwrap().ends_with("/plan.jpg"));
    assert!(rec.warnings[0].starts_with("low-resolution"));

    // A plan is not a panorama, and a PDF needs exporting first.
    assert_eq!(
        run(&f, &scan, &ImportOptions::default())
            .0
            .unwrap_err()
            .code(),
        "invalid"
    );
    let pdf = f.inbox.join("Level 2.pdf");
    std::fs::write(&pdf, b"%PDF-1.7").unwrap();
    let err = run(&f, &pdf, &plan_opts).0.unwrap_err();
    assert!(
        err.to_string().contains("export the plan as a PNG"),
        "{err}"
    );
    assert_eq!(media_entries(&f.root).len(), 2);
}

#[test]
fn imports_sounds_documents_and_photos_checked_by_content() {
    let f = fixture();
    let opts = |purpose| ImportOptions {
        purpose,
        ..ImportOptions::default()
    };

    // A WAV sound: kept as imported.
    let wav = f.inbox.join("Fire alarm.wav");
    let mut bytes = b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec();
    bytes.extend([0u8; 32]);
    std::fs::write(&wav, &bytes).unwrap();
    let rec = run(&f, &wav, &opts(Purpose::Audio)).0.unwrap();
    assert_eq!(rec.kind, AssetKind::Audio);
    assert!(rec.source.ends_with("/source.wav"));
    assert_eq!(std::fs::read(f.root.join(&rec.source)).unwrap(), bytes);
    // Renamed to .wav but not a WAV: refused, nothing left behind.
    let fake = f.inbox.join("not really.wav");
    std::fs::write(&fake, b"hello world, not audio").unwrap();
    let before = media_entries(&f.root);
    let err = run(&f, &fake, &opts(Purpose::Audio)).0.unwrap_err();
    assert_eq!(err.code(), "invalid");
    assert_eq!(media_entries(&f.root), before);
    assert_eq!(
        run(&f, &f.inbox.join("x.exe"), &opts(Purpose::Audio))
            .0
            .unwrap_err()
            .code(),
        "invalid"
    );

    // A PDF document.
    let pdf = f.inbox.join("Procedures.pdf");
    std::fs::write(
        &pdf,
        b"%PDF-1.7\n%\xe2\xe3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    )
    .unwrap();
    let rec = run(&f, &pdf, &opts(Purpose::Document)).0.unwrap();
    assert_eq!(rec.kind, AssetKind::Document);
    assert!(rec.source.ends_with("/source.pdf"));
    let not_pdf = f.inbox.join("Report.pdf");
    std::fs::write(&not_pdf, b"<html>not a pdf</html>").unwrap();
    assert!(run(&f, &not_pdf, &opts(Purpose::Document))
        .0
        .unwrap_err()
        .to_string()
        .contains("not a valid PDF"));
    // Word files need exporting first.
    let docx = f.inbox.join("Procedures.docx");
    std::fs::write(&docx, b"PK").unwrap();
    assert!(run(&f, &docx, &opts(Purpose::Document))
        .0
        .unwrap_err()
        .to_string()
        .contains("export a PDF first"));

    // A photo: any aspect ratio, fitted and thumbnailed.
    let photo = f.inbox.join("Entrance.jpg");
    RgbImage::from_pixel(1200, 800, Rgb([120, 90, 60]))
        .save(&photo)
        .unwrap();
    let rec = run(&f, &photo, &opts(Purpose::Photo)).0.unwrap();
    assert_eq!(rec.kind, AssetKind::Photo);
    assert_eq!((rec.width, rec.height), (Some(1200), Some(800)));
    assert!(rec.preview.unwrap().ends_with("/photo.jpg"));
    assert!(rec.thumbnail.is_some());
    assert!(rec.warnings.is_empty());
    assert_eq!(library::list(&f.root).unwrap().assets.len(), 3);
}
