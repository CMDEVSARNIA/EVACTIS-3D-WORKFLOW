//! Locating Studio projects.
//!
//! A project is a folder holding `<name>.evxproj` (the environment JSON manifest) and
//! its `media/`. Windows cannot associate a *folder* by extension, so the
//! double-clickable `.evxproj` is the manifest file; Studio opens its parent folder.
//! A folder named `<name>.evxproj` is also accepted (see docs/decisions/0004).

use std::path::{Path, PathBuf};

use crate::identity::PROJECT_EXT;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLocation {
    /// Project root folder (holds media/ and snapshots/).
    pub root: PathBuf,
    /// The manifest file.
    pub manifest: PathBuf,
}

fn has_ext(p: &Path, ext: &str) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Resolves a path the user opened (manifest file or project folder) to a project.
pub fn locate(path: &Path) -> Result<ProjectLocation, String> {
    if path.is_file() {
        if !has_ext(path, PROJECT_EXT) {
            return Err(format!("{} is not a .{PROJECT_EXT} file", path.display()));
        }
        let root = path.parent().map(Path::to_path_buf).unwrap_or_default();
        return Ok(ProjectLocation { root, manifest: path.to_path_buf() });
    }
    if path.is_dir() {
        let manifests: Vec<PathBuf> = std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file() && has_ext(p, PROJECT_EXT))
            .collect();
        return match manifests.as_slice() {
            [one] => Ok(ProjectLocation { root: path.to_path_buf(), manifest: one.clone() }),
            [] => Err(format!("No .{PROJECT_EXT} file in {}", path.display())),
            _ => Err(format!("More than one .{PROJECT_EXT} file in {}", path.display())),
        };
    }
    Err(format!("{} does not exist", path.display()))
}

/// Checks a project name is usable as a Windows folder and file name.
pub fn validate_name(name: &str) -> Result<(), String> {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("The project needs a name".into());
    }
    if name.chars().count() > 80 {
        return Err("Project names are limited to 80 characters".into());
    }
    if let Some(c) = name.chars().find(|c| r#"<>:"/\|?*"#.contains(*c) || c.is_control()) {
        return Err(format!("Project names cannot contain {c:?}"));
    }
    if name != trimmed || name.ends_with('.') {
        return Err("Project names cannot start or end with a space, or end with a dot".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(format!("{name} is reserved by Windows"));
    }
    Ok(())
}

/// Creates `<parent>/<name>/` with `<name>.evxproj` and an empty `media/` folder.
/// Refuses to touch an existing, non-empty folder.
pub fn create(parent: &Path, name: &str, manifest: &[u8]) -> Result<ProjectLocation, String> {
    validate_name(name)?;
    if !parent.is_dir() {
        return Err(format!("{} is not a folder", parent.display()));
    }
    let root = parent.join(name);
    if root.exists() && std::fs::read_dir(&root).map_err(|e| e.to_string())?.next().is_some() {
        return Err(format!("{} already exists and is not empty", root.display()));
    }
    std::fs::create_dir_all(root.join("media")).map_err(|e| e.to_string())?;
    let loc = ProjectLocation { manifest: root.join(format!("{name}.{PROJECT_EXT}")), root };
    save_manifest(&loc, manifest)?;
    Ok(loc)
}

/// Replaces the manifest atomically, keeping the previous version as `.bak`.
pub fn save_manifest(loc: &ProjectLocation, manifest: &[u8]) -> Result<(), String> {
    let tmp = loc.manifest.with_extension(format!("{PROJECT_EXT}.tmp"));
    std::fs::write(&tmp, manifest).map_err(|e| e.to_string())?;
    if loc.manifest.exists() {
        let bak = loc.manifest.with_extension(format!("{PROJECT_EXT}.bak"));
        std::fs::copy(&loc.manifest, bak).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &loc.manifest).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("evx-core-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn opens_manifest_file_or_folder() {
        let d = temp("ok");
        let m = d.join("Riverside.evxproj");
        fs::write(&m, "{}").unwrap();
        assert_eq!(locate(&m).unwrap(), ProjectLocation { root: d.clone(), manifest: m.clone() });
        assert_eq!(locate(&d).unwrap().manifest, m);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn rejects_wrong_or_ambiguous_input() {
        let d = temp("bad");
        assert!(locate(&d).unwrap_err().contains("No .evxproj"));
        fs::write(d.join("a.evxproj"), "{}").unwrap();
        fs::write(d.join("b.EVXPROJ"), "{}").unwrap();
        assert!(locate(&d).unwrap_err().contains("More than one"));
        fs::write(d.join("x.txt"), "").unwrap();
        assert!(locate(&d.join("x.txt")).is_err());
        assert!(locate(&d.join("missing")).is_err());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn names_must_work_on_windows() {
        assert!(validate_name("Riverside Plant – Building A").is_ok());
        for bad in ["", "  ", "a/b", "a:b", "what?", "CON", "com1.txt", "trailing.", " lead", "x".repeat(81).as_str()] {
            assert!(validate_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn creates_and_saves_projects() {
        let d = temp("create");
        let loc = create(&d, "Riverside", b"{\"v\":1}").unwrap();
        assert_eq!(loc.manifest, d.join("Riverside").join("Riverside.evxproj"));
        assert!(loc.root.join("media").is_dir());
        assert_eq!(locate(&loc.root).unwrap(), loc);
        save_manifest(&loc, b"{\"v\":2}").unwrap();
        assert_eq!(fs::read(&loc.manifest).unwrap(), b"{\"v\":2}");
        assert_eq!(fs::read(loc.manifest.with_extension("evxproj.bak")).unwrap(), b"{\"v\":1}");
        assert!(create(&d, "Riverside", b"{}").unwrap_err().contains("not empty"));
        assert!(create(&d.join("missing"), "X", b"{}").is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
