//! Structural checks for 3D assets (GLB models, Gaussian splats). These catch truncated
//! downloads, renamed files and wrong formats at import time; rendering is Phase 9.

use crate::error::{MediaError, Result};
use flate2::read::GzDecoder;
use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
};

fn invalid(m: impl Into<String>) -> MediaError {
    MediaError::Invalid(m.into())
}

/// glTF 2.0 binary: 12-byte header ("glTF", version 2, total length) then a JSON chunk.
pub fn check_glb(path: &Path) -> Result<()> {
    let len = std::fs::metadata(path)?.len();
    let mut head = [0u8; 20];
    File::open(path)?
        .read_exact(&mut head)
        .map_err(|_| invalid("GLB file is too short"))?;
    let u32_at = |i: usize| u32::from_le_bytes([head[i], head[i + 1], head[i + 2], head[i + 3]]);
    if &head[0..4] != b"glTF" {
        return Err(invalid("not a GLB file (missing glTF header)"));
    }
    if u32_at(4) != 2 {
        return Err(invalid(format!(
            "GLB version {} is not supported (glTF 2.0 only)",
            u32_at(4)
        )));
    }
    if u64::from(u32_at(8)) != len {
        return Err(invalid(format!(
            "GLB file is incomplete: header says {} bytes, file has {len}",
            u32_at(8)
        )));
    }
    if u32_at(16) != 0x4E4F_534A {
        return Err(invalid("GLB file does not start with a JSON chunk"));
    }
    Ok(())
}

/// Validates a splat file and returns its Gaussian count when the format states it.
pub fn check_splat(path: &Path, format: &str) -> Result<Option<u64>> {
    match format {
        "ply" => check_ply(path).map(Some),
        "splat" => {
            // antimatter15 layout: 32 bytes per Gaussian, no header.
            let len = std::fs::metadata(path)?.len();
            if len == 0 || len % 32 != 0 {
                return Err(invalid(
                    ".splat file size is not a whole number of 32-byte splats",
                ));
            }
            Ok(Some(len / 32))
        }
        "ksplat" => {
            // 4096-byte header; first two bytes are the format version (0.1+).
            let len = std::fs::metadata(path)?.len();
            let mut head = [0u8; 2];
            File::open(path)?
                .read_exact(&mut head)
                .map_err(|_| invalid(".ksplat file is too short"))?;
            if len <= 4096 || head[0] != 0 || head[1] == 0 {
                return Err(invalid("not a .ksplat file (unexpected header)"));
            }
            Ok(None)
        }
        "spz" => {
            // gzip stream; header magic "NGSP", version 2 or 3, Gaussian count.
            let mut head = [0u8; 12];
            GzDecoder::new(File::open(path)?)
                .read_exact(&mut head)
                .map_err(|_| invalid("not a .spz file (not gzip-compressed or too short)"))?;
            let u32_at =
                |i: usize| u32::from_le_bytes([head[i], head[i + 1], head[i + 2], head[i + 3]]);
            if u32_at(0) != 0x5053_474E {
                return Err(invalid("not a .spz file (missing NGSP header)"));
            }
            if !(2..=3).contains(&u32_at(4)) {
                return Err(invalid(format!(
                    ".spz version {} is not supported",
                    u32_at(4)
                )));
            }
            Ok(Some(u64::from(u32_at(8))))
        }
        other => Err(invalid(format!(".{other} is not a supported splat format"))),
    }
}

fn ply_type_size(t: &str) -> Option<u64> {
    Some(match t {
        "char" | "uchar" | "int8" | "uint8" => 1,
        "short" | "ushort" | "int16" | "uint16" => 2,
        "int" | "uint" | "float" | "int32" | "uint32" | "float32" => 4,
        "double" | "float64" => 8,
        _ => return None,
    })
}

/// Binary little-endian PLY with Gaussian properties; checks the body is complete.
fn check_ply(path: &Path) -> Result<u64> {
    let len = std::fs::metadata(path)?.len();
    let mut r = BufReader::new(File::open(path)?);
    let mut line = String::new();
    let mut header_bytes = 0u64;
    fn next(r: &mut impl BufRead, line: &mut String, header_bytes: &mut u64) -> Result<bool> {
        line.clear();
        let n = r
            .read_line(line)
            .map_err(|_| invalid("PLY header is not text"))?;
        *header_bytes += n as u64;
        Ok(n > 0)
    }
    if !next(&mut r, &mut line, &mut header_bytes)? || line.trim_end() != "ply" {
        return Err(invalid("not a PLY file"));
    }
    let (mut vertices, mut stride, mut in_vertex, mut binary, mut gaussian) =
        (None, 0u64, false, false, false);
    let mut other_elements = false;
    loop {
        if !next(&mut r, &mut line, &mut header_bytes)? {
            return Err(invalid("PLY header has no end_header"));
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        match words.as_slice() {
            ["end_header"] => break,
            ["format", f, _] => binary = *f == "binary_little_endian",
            ["element", "vertex", n] => {
                vertices = n.parse::<u64>().ok();
                in_vertex = true;
            }
            ["element", ..] => {
                in_vertex = false;
                other_elements = true;
            }
            ["property", "list", ..] if in_vertex => {
                return Err(invalid("PLY vertices with list properties are not splats"))
            }
            ["property", t, name] if in_vertex => {
                stride +=
                    ply_type_size(t).ok_or_else(|| invalid(format!("unknown PLY type {t}")))?;
                if name.starts_with("f_dc_") || name.starts_with("scale_") {
                    gaussian = true;
                }
            }
            _ => {}
        }
        if header_bytes > 64 * 1024 {
            return Err(invalid("PLY header is too long"));
        }
    }
    if !binary {
        return Err(invalid(
            "only binary little-endian PLY splats are supported",
        ));
    }
    if !gaussian {
        return Err(invalid("PLY file has no Gaussian splat properties (f_dc_*, scale_*): it looks like a point cloud or mesh"));
    }
    let n = vertices
        .filter(|n| *n > 0)
        .ok_or_else(|| invalid("PLY file has no vertices"))?;
    let need = header_bytes + n * stride;
    if len < need || (!other_elements && len != need) {
        return Err(invalid(format!(
            "PLY file is incomplete: expected {need} bytes, file has {len}"
        )));
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    fn file(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = dir.path().join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn glb(declared: Option<u32>, version: u32) -> Vec<u8> {
        let json = br#"{"asset":{"version":"2.0"}}    "#;
        let total = 12 + 8 + json.len() as u32;
        let mut v = b"glTF".to_vec();
        v.extend(version.to_le_bytes());
        v.extend(declared.unwrap_or(total).to_le_bytes());
        v.extend((json.len() as u32).to_le_bytes());
        v.extend(0x4E4F_534Au32.to_le_bytes());
        v.extend(json);
        v
    }

    #[test]
    fn glb_checks() {
        let d = tempfile::tempdir().unwrap();
        assert!(check_glb(&file(&d, "ok.glb", &glb(None, 2))).is_ok());
        assert!(check_glb(&file(&d, "v1.glb", &glb(None, 1))).is_err());
        assert!(check_glb(&file(&d, "cut.glb", &glb(Some(999), 2))).is_err());
        assert!(check_glb(&file(&d, "jpg.glb", &[0xFF, 0xD8, 0xFF, 0xE0])).is_err());
    }

    fn ply(n: u64, props: &[&str], body: usize) -> Vec<u8> {
        let mut h = format!("ply\nformat binary_little_endian 1.0\nelement vertex {n}\n");
        for p in props {
            h += &format!("property float {p}\n");
        }
        h += "end_header\n";
        let mut v = h.into_bytes();
        v.extend(vec![0u8; body]);
        v
    }

    #[test]
    fn splat_checks() {
        let d = tempfile::tempdir().unwrap();
        let props = ["x", "y", "z", "f_dc_0", "scale_0"];
        assert_eq!(
            check_splat(&file(&d, "a.ply", &ply(3, &props, 60)), "ply").unwrap(),
            Some(3)
        );
        assert!(check_splat(&file(&d, "cut.ply", &ply(3, &props, 59)), "ply").is_err());
        assert!(check_splat(&file(&d, "mesh.ply", &ply(3, &["x", "y", "z"], 36)), "ply").is_err());
        assert_eq!(
            check_splat(&file(&d, "a.splat", &[0u8; 64]), "splat").unwrap(),
            Some(2)
        );
        assert!(check_splat(&file(&d, "b.splat", &[0u8; 65]), "splat").is_err());

        let mut gz = GzEncoder::new(vec![], Compression::default());
        gz.write_all(&0x5053_474Eu32.to_le_bytes()).unwrap();
        gz.write_all(&2u32.to_le_bytes()).unwrap();
        gz.write_all(&1234u32.to_le_bytes()).unwrap();
        gz.write_all(&[0u8; 4]).unwrap();
        let spz = gz.finish().unwrap();
        assert_eq!(
            check_splat(&file(&d, "a.spz", &spz), "spz").unwrap(),
            Some(1234)
        );
        assert!(check_splat(&file(&d, "b.spz", b"NGSP not gzip"), "spz").is_err());

        let mut ks = vec![0u8, 1];
        ks.resize(5000, 0);
        assert!(check_splat(&file(&d, "a.ksplat", &ks), "ksplat").is_ok());
        assert!(check_splat(&file(&d, "b.ksplat", &[0u8; 10]), "ksplat").is_err());
    }
}
